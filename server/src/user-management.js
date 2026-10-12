import bcrypt from "bcryptjs";
import { z } from "zod";

export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email(),
  password: z.string().min(12).max(128),
  role: z.enum(["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"]).default("MEMBER"),
});

export async function createOrganizationUser(prisma, {
  organizationId,
  actorId,
  name,
  email,
  password,
  role,
  customRoleId,
}) {
  const normalizedEmail = email.toLowerCase();
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });
  if (existingUser) {
    return { conflict: true };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.create({
      data: {
        name,
        email: normalizedEmail,
        passwordHash,
        memberships: {
          create: {
            organizationId,
            role,
            ...(customRoleId ? { customRoleId } : {}),
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        memberships: {
          where: { organizationId },
          select: { id: true, role: true, customRoleId: true },
        },
      },
    });

    await transaction.auditEvent.create({
      data: {
        organizationId,
        actorId,
        action: "USER_CREATED",
        targetType: "USER",
        targetId: user.id,
        metadata: { role, ...(customRoleId ? { customRoleId } : {}) },
      },
    });
    await transaction.monitoringEvent.create({
      data: {
        type: "ACCOUNT_CREATED",
        userId: user.id,
        actorId,
        organizationId,
        role: customRoleId ? "Custom role" : role,
      },
    });

    return user;
  }, { maxWait: 10000, timeout: 20000 });

  const membership = result.memberships[0];
  return {
    user: {
      id: result.id,
      name: result.name,
      email: result.email,
      createdAt: result.createdAt.toISOString(),
    },
    membership: {
      id: membership.id,
      role: membership.role,
      customRoleId: membership.customRoleId,
    },
  };
}
