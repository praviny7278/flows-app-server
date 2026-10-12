import { Router } from "express";
import bcrypt from "bcryptjs";
import { Resend } from "resend";
import { z } from "zod";
import { invalidateUserSessions } from "./cache.js";
import { createLogger } from "./logger.js";

const logger = createLogger("password-recovery");
const approvalLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const recoveryRoleLabels = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  MEMBER: "Member",
  VIEWER: "Viewer",
};
const emailSchema = z.object({
  email: z.string().trim().email(),
  organizationId: z.string().optional(),
});
const completeRequestSchema = z.object({
  newPassword: z.string().min(12).max(128),
});

function parseBody(schema, request, response) {
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "The request contains invalid data.",
        details: parsed.error.issues,
      },
    });
    return null;
  }
  return parsed.data;
}

function emailConfiguration() {
  if (!process.env.RESEND_API_KEY) return null;
  return {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM || "FlowOps <onboarding@resend.dev>",
  };
}

function textToHtml(text) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return `<p>${escaped.replace(/\n/g, "<br>")}</p>`;
}

async function sendEmail({ to, subject, text, html }) {
  const config = emailConfiguration();
  if (!config) return false;
  const resend = new Resend(config.apiKey);
  const { data, error } = await resend.emails.send({
    from: config.from,
    to: [to],
    subject,
    html: html ?? textToHtml(text),
    text,
  });
  if (error) {
    logger.error("Email sending failed:", error);
    throw new Error(error.message);
  }
  logger.info("Email sent:", data?.id);
  return true;
}

function recoveryResponse(response) {
  response.status(202).json({
    message: "Your password reset request has been sent to an administrator or owner of your organization. They will set a new password for you manually.",
  });
}

async function findMembership(prisma, userId, organizationId) {
  if (organizationId) {
    return prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: { organization: { select: { id: true, name: true } } },
    });
  }
  return prisma.organizationMembership.findFirst({
    where: { userId },
    orderBy: { joinedAt: "asc" },
    include: { organization: { select: { id: true, name: true } } },
  });
}

async function recordRecoveryAudit(prisma, request, action, actorId, metadata = {}) {
  if (!request.organizationId) return;
  await prisma.auditEvent.create({
    data: {
      organizationId: request.organizationId,
      actorId,
      action,
      targetType: "PASSWORD_RECOVERY_REQUEST",
      targetId: request.id,
      metadata,
    },
  });
}

export async function completePasswordRecovery(prisma, recoveryRequest, actorId, newPassword) {
  const claimed = await prisma.passwordRecoveryRequest.updateMany({
    where: { id: recoveryRequest.id, status: recoveryRequest.status },
    data: { status: "PROCESSING", reviewedById: actorId },
  });
  if (claimed.count !== 1) {
    return false;
  }

  try {
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: recoveryRequest.requesterId },
        data: { passwordHash },
      });
      await transaction.session.deleteMany({ where: { userId: recoveryRequest.requesterId } });
      await transaction.passwordRecoveryRequest.update({
        where: { id: recoveryRequest.id },
        data: {
          status: "COMPLETED",
          expiresAt: null,
          reviewedById: actorId,
        },
      });
      await recordRecoveryAudit(transaction, recoveryRequest, "PASSWORD_RECOVERY_COMPLETED", actorId, {
        requesterRole: recoveryRequest.requesterRole,
      });
      await transaction.monitoringEvent.create({
        data: {
          type: "PASSWORD_CHANGED",
          userId: recoveryRequest.requesterId,
          actorId,
          ...(recoveryRequest.organizationId ? { organizationId: recoveryRequest.organizationId } : {}),
          role: recoveryRequest.requesterRole,
        },
      });
    });
    await invalidateUserSessions(recoveryRequest.requesterId);
    return true;
  } catch (error) {
    await prisma.passwordRecoveryRequest.updateMany({
      where: { id: recoveryRequest.id, status: "PROCESSING" },
      data: { status: recoveryRequest.status, reviewedById: null },
    });
    throw error;
  }
}

export function createPasswordRecoveryRouters(prisma, { publicLimiter = (_request, _response, next) => next() } = {}) {
  const publicRouter = Router();
  const authenticatedRouter = Router();

  publicRouter.post("/forgot", publicLimiter, async (request, response) => {
    const input = parseBody(emailSchema, request, response);
    if (!input) return;

    if (!emailConfiguration()) {
      response.status(503).json({
        error: {
          code: "RECOVERY_NOT_CONFIGURED",
          message: "Resend email delivery is not configured. Please contact support.",
        },
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      select: { id: true, email: true },
    });
    if (!user) {
      recoveryResponse(response);
      return;
    }

    const membership = await findMembership(prisma, user.id, input.organizationId);
    if (!membership) {
      recoveryResponse(response);
      return;
    }

    const recent = await prisma.passwordRecoveryRequest.findFirst({
      where: {
        requesterId: user.id,
        organizationId: membership.organizationId,
        createdAt: { gte: new Date(Date.now() - 60 * 1000) },
        status: { in: ["PENDING", "PROCESSING"] },
      },
    });
    if (recent) {
      recoveryResponse(response);
      return;
    }

    const now = new Date();

    const recoveryRequest = await prisma.passwordRecoveryRequest.create({
      data: {
        requesterId: user.id,
        organizationId: membership.organizationId,
        requesterRole: membership.role,
        status: "PENDING",
        expiresAt: new Date(now.getTime() + approvalLifetimeMs),
      },
    });

    const approvers = await prisma.organizationMembership.findMany({
      where: {
        organizationId: membership.organizationId,
        role: { in: ["OWNER", "ADMIN"] },
        userId: { not: user.id },
      },
      select: {
        userId: true,
        user: { select: { email: true, name: true } },
      },
    });
    if (approvers.length === 0) {
      await prisma.passwordRecoveryRequest.delete({ where: { id: recoveryRequest.id } });
      response.status(409).json({ error: { code: "NO_APPROVER", message: "No eligible administrator is configured for this organization." } });
      return;
    }
    try {
      await Promise.all(approvers.map(({ user: approver }) => sendEmail({
        to: approver.email,
        subject: "Password reset requested",
        text: `${recoveryRoleLabels[membership.role]} ${user.email} requested a password reset for ${membership.organization.name}. Sign in to FlowOps to review the request and set a new temporary password for them.`,
      })));
    } catch (error) {
      logger.error("Password recovery approver email failed", error.name);
      await prisma.passwordRecoveryRequest.delete({ where: { id: recoveryRequest.id } });
      response.status(503).json({
        error: {
          code: "EMAIL_DELIVERY_FAILED",
          message: "The organization approver could not be emailed. Please try again later.",
        },
      });
      return;
    }
    await prisma.notification.createMany({
      data: approvers.map(({ userId }) => ({
        organizationId: membership.organizationId,
        userId,
        type: "APPROVAL_REQUIRED",
        title: "Password recovery request",
        message: `${recoveryRoleLabels[membership.role]} ${user.email} requested a password change.`,
        targetType: "PASSWORD_RECOVERY_REQUEST",
        targetId: recoveryRequest.id,
      })),
    });

    await recordRecoveryAudit(prisma, recoveryRequest, "PASSWORD_RECOVERY_REQUESTED", user.id, {
      requesterRole: membership.role,
    });
    recoveryResponse(response);
  });

  authenticatedRouter.get("/requests", async (request, response) => {
    const organizationId = typeof request.query.organizationId === "string"
      ? request.query.organizationId
      : request.get("x-organization-id");
    const membership = await findMembership(prisma, response.locals.user.id, organizationId);
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "An organization owner or admin is required." } });
      return;
    }
    const allowedRequesterRoles = membership.role === "OWNER"
      ? ["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"]
      : ["MANAGER", "MEMBER", "VIEWER"];
    const requests = await prisma.passwordRecoveryRequest.findMany({
      where: {
        organizationId: membership.organizationId,
        requesterRole: { in: allowedRequesterRoles },
        requesterId: { not: response.locals.user.id },
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
      include: {
        requester: { select: { id: true, email: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    response.json({
      data: requests.map((item) => ({
        id: item.id,
        requester: item.requester,
        requesterRole: item.requesterRole,
        organizationId: item.organizationId,
        createdAt: item.createdAt.toISOString(),
        expiresAt: item.expiresAt?.toISOString() ?? null,
      })),
    });
  });

  authenticatedRouter.post("/requests/:requestId/complete", async (request, response) => {
    const input = parseBody(completeRequestSchema, request, response);
    if (!input) return;
    const organizationId = typeof request.query.organizationId === "string"
      ? request.query.organizationId
      : request.get("x-organization-id");
    const membership = await findMembership(prisma, response.locals.user.id, organizationId);
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "An organization owner or admin is required." } });
      return;
    }
    const recoveryRequest = await prisma.passwordRecoveryRequest.findFirst({
      where: {
        id: request.params.requestId,
        organizationId: membership.organizationId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
    });
    if (!recoveryRequest) {
      response.status(404).json({ error: { code: "REQUEST_NOT_FOUND", message: "An active password recovery request was not found." } });
      return;
    }
    if (recoveryRequest.requesterId === response.locals.user.id) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "You cannot reset your own password through a recovery request." } });
      return;
    }
    const allowedRequesterRoles = membership.role === "OWNER"
      ? ["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"]
      : ["MANAGER", "MEMBER", "VIEWER"];
    if (!allowedRequesterRoles.includes(recoveryRequest.requesterRole)) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "You cannot approve this recovery request." } });
      return;
    }

    const completed = await completePasswordRecovery(prisma, recoveryRequest, response.locals.user.id, input.newPassword);
    if (!completed) {
      response.status(409).json({ error: { code: "REQUEST_ALREADY_HANDLED", message: "This recovery request has already been handled." } });
      return;
    }
    response.json({ message: "Password changed and existing sessions revoked." });
  });

  return { publicRouter, authenticatedRouter };
}
