import { Router } from "express";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { cachedCount } from "./count-cache.js";
import { createOrganizationUser, createUserSchema } from "./user-management.js";
import {
	getCachedMembership,
	invalidateMembership,
	invalidateSession,
	invalidateUserSessions,
	setCachedMembership,
} from "./cache.js";

const organizationRoles = ["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"];
const roleLabels = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  MEMBER: "Member",
  VIEWER: "Viewer",
};
const rolePermissionKeys = [
  "PROJECT_READ",
  "PROJECT_WRITE",
  "TASK_READ",
  "TASK_WRITE",
  "MEMBER_READ",
  "MEMBER_MANAGE",
  "ROLE_MANAGE",
  "ANALYTICS_READ",
  "AUDIT_READ",
  "NOTIFICATION_READ",
  "NOTIFICATION_MANAGE",
  "COMMENT_MODERATE",
];
const readPermissions = [
  "PROJECT_READ",
  "TASK_READ",
  "MEMBER_READ",
  "ANALYTICS_READ",
  "AUDIT_READ",
  "NOTIFICATION_READ",
];
const writablePermissions = ["PROJECT_WRITE", "TASK_WRITE"];
const builtInPermissions = {
  OWNER: [...rolePermissionKeys],
  ADMIN: [...rolePermissionKeys],
  MANAGER: [...readPermissions, ...writablePermissions, "NOTIFICATION_MANAGE"],
  MEMBER: [...readPermissions, ...writablePermissions, "NOTIFICATION_MANAGE"],
  VIEWER: [...readPermissions, "NOTIFICATION_MANAGE"],
};
const permissionLabels = {
  PROJECT_READ: "View projects",
  PROJECT_WRITE: "Manage projects",
  TASK_READ: "View tasks",
  TASK_WRITE: "Manage tasks",
  MEMBER_READ: "View team members",
  MEMBER_MANAGE: "Manage team members",
  ROLE_MANAGE: "Manage roles and permissions",
  ANALYTICS_READ: "View analytics",
  AUDIT_READ: "View audit logs",
  NOTIFICATION_READ: "View notifications",
  NOTIFICATION_MANAGE: "Manage notifications",
  COMMENT_MODERATE: "Moderate other members' comments",
};
const projectStatuses = {
  "On track": "ON_TRACK",
  "At risk": "AT_RISK",
  Review: "REVIEW",
  Done: "DONE",
  ON_TRACK: "ON_TRACK",
  AT_RISK: "AT_RISK",
  REVIEW: "REVIEW",
  DONE: "DONE",
};
const projectStatusLabels = {
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  REVIEW: "Review",
  DONE: "Done",
};
const taskStatuses = {
  Queued: "QUEUED",
  "In review": "IN_REVIEW",
  Blocked: "BLOCKED",
  Done: "DONE",
  QUEUED: "QUEUED",
  IN_REVIEW: "IN_REVIEW",
  BLOCKED: "BLOCKED",
  DONE: "DONE",
};
const taskStatusLabels = {
  QUEUED: "Queued",
  IN_REVIEW: "In review",
  BLOCKED: "Blocked",
  DONE: "Done",
};
const taskPriorities = {
  High: "HIGH",
  Medium: "MEDIUM",
  Low: "LOW",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
};
const taskPriorityLabels = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

const profileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  preferences: z.record(z.string(), z.unknown()).nullable().optional(),
}).refine((data) => Object.keys(data).length > 0);
const organizationSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
const organizationUpdateSchema = organizationSchema.partial().refine((data) => Object.keys(data).length > 0);
const memberSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(organizationRoles).default("MEMBER"),
  customRoleId: z.string().min(1).optional(),
});
const memberUpdateSchema = z.object({
  role: z.enum(organizationRoles).optional(),
  customRoleId: z.string().min(1).nullable().optional(),
}).refine((data) => Object.keys(data).length > 0);
const customRoleCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).default(""),
  permissions: z.array(z.enum(rolePermissionKeys)).max(rolePermissionKeys.length),
});
const customRoleUpdateSchema = customRoleCreateSchema.partial()
  .refine((data) => Object.keys(data).length > 0);
const projectFieldsSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().max(10000).optional(),
  status: z.string().refine((value) => value in projectStatuses).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  valueAmount: z.number().int().min(0).optional(),
  currency: z.string().trim().length(3).optional(),
  ownerId: z.string().nullable().optional(),
  ownerLabel: z.string().trim().max(100).nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});
const projectSchema = projectFieldsSchema.refine((data) => Object.keys(data).length > 0);
const projectCreateSchema = projectFieldsSchema.extend({
  name: z.string().trim().min(1).max(160),
});
const taskFieldsSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  notes: z.string().max(5000).optional(),
  assignee: z.string().trim().max(100).optional(),
  assigneeLabel: z.string().trim().max(100).nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  priority: z.string().refine((value) => value in taskPriorities).optional(),
  status: z.string().refine((value) => value in taskStatuses).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  due: z.string().max(80).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  stage: z.string().max(120).optional(),
});
const taskSchema = taskFieldsSchema.refine((data) => Object.keys(data).length > 0);
const taskCreateSchema = taskFieldsSchema.extend({
  title: z.string().trim().min(1).max(160),
});
const commentSchema = z.object({
  body: z.string().trim().min(1).max(10000),
});
const projectMilestoneSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  completed: z.boolean().optional(),
});
const projectDeliverableSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().max(5000).optional(),
  completed: z.boolean().optional(),
});
const projectRiskSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().max(5000).optional(),
  resolved: z.boolean().optional(),
});
const notificationUpdateSchema = z.object({
  read: z.boolean().optional(),
  dismissed: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0);

function sendValidationError(response, details) {
  response.status(400).json({
    error: {
      code: "VALIDATION_ERROR",
      message: "The request contains invalid data.",
      details,
    },
  });
}

function parseBody(schema, request, response) {
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    sendValidationError(response, parsed.error.issues);
    return null;
  }
  return parsed.data;
}

function parsePagination(request, response) {
  const page = Number(request.query.page ?? 1);
  const pageSize = Number(request.query.pageSize ?? 50);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    sendValidationError(response, [{ path: ["query"], message: "page must be positive and pageSize must be between 1 and 100." }]);
    return null;
  }
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function paginatedResponse(response, data, total, { page, pageSize }, extraMeta) {
  response.json({ data, meta: { total, page, pageSize, pageCount: Math.ceil(total / pageSize), ...extraMeta } });
}

function makeSlug(name) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "workspace";
  return `${base}-${randomBytes(4).toString("hex")}`;
}

function dateInput(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value === "Unscheduled" || value === "Completed") return null;
  if (value === "Today" || value === "Tomorrow") {
    const date = new Date();
    if (value === "Tomorrow") date.setUTCDate(date.getUTCDate() + 1);
    date.setUTCHours(12, 0, 0, 0);
    return date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dateLabel(value) {
  if (!value) return "Unscheduled";
  return value.toISOString().slice(0, 10);
}

function formatValue(amount, currency) {
  const symbol = currency === "USD" ? "$" : `${currency} `;
  return amount >= 1000 ? `${symbol}${Math.round(amount / 1000)}K` : `${symbol}${amount}`;
}

function projectResponse(project) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    owner: project.owner?.name ?? project.ownerLabel ?? "Unassigned",
    ownerId: project.ownerId,
    status: projectStatusLabels[project.status],
    progress: project.progress,
    value: formatValue(project.valueAmount, project.currency),
    valueAmount: project.valueAmount,
    currency: project.currency,
    startDate: project.startDate?.toISOString() ?? null,
    dueDate: project.dueDate?.toISOString() ?? null,
    archivedAt: project.archivedAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function taskResponse(task) {
  return {
    id: task.id,
    title: task.title,
    assignee: task.assignee?.name ?? task.assigneeLabel ?? "Unassigned",
    assigneeId: task.assigneeId,
    priority: taskPriorityLabels[task.priority],
    status: taskStatusLabels[task.status],
    progress: task.progress,
    due: task.status === "DONE" && !task.dueDate ? "Completed" : dateLabel(task.dueDate),
    dueDate: task.dueDate?.toISOString() ?? null,
    stage: task.stage,
    notes: task.notes,
    projectId: task.projectId,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    completedAt: task.completedAt?.toISOString() ?? null,
  };
}

function reviveMembership(membership) {
	return {
		...membership,
		organization: {
			...membership.organization,
			createdAt: new Date(membership.organization.createdAt),
			updatedAt: new Date(membership.organization.updatedAt),
		},
	};
}

async function invalidateOrganizationCache(prisma, organizationId) {
	const members = await prisma.organizationMembership.findMany({
		where: { organizationId },
		select: { userId: true },
	});
	await Promise.all(
		members.map(async ({ userId }) => {
			await invalidateMembership(userId, organizationId);
			await invalidateUserSessions(userId);
		}),
	);
}

function resolveOrganization(prisma) {
  return async (request, response, next) => {
    const userId = response.locals.user.id;
    const requestedOrganizationId = request.get("x-organization-id");
    const organizationKey = request.params.organizationId ?? requestedOrganizationId ?? "first";

    let membership = await getCachedMembership(userId, organizationKey);
    if (membership) {
      membership = reviveMembership(membership);
    } else if (request.params.organizationId) {
      membership = await prisma.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: request.params.organizationId,
            userId,
          },
        },
        include: { organization: true, customRole: true },
      });
      if (membership) await setCachedMembership(userId, organizationKey, membership);
    } else {
      membership = requestedOrganizationId
        ? await prisma.organizationMembership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: requestedOrganizationId,
              userId,
            },
          },
          include: { organization: true, customRole: true },
        })
        : await prisma.organizationMembership.findFirst({
          where: { userId },
          orderBy: { joinedAt: "asc" },
          include: { organization: true, customRole: true },
        });
      if (membership) await setCachedMembership(userId, organizationKey, membership);
    }

    if (!membership) {
      response.status(404).json({ error: { code: "ORGANIZATION_NOT_FOUND", message: "Organization not found." } });
      return;
    }
    request.organization = membership.organization;
    request.organizationRole = membership.role;
    request.organizationCustomRole = membership.customRole;
    next();
  };
}

function hasPermission(request, permission) {
  const permissions = request.organizationCustomRole?.permissions ?? builtInPermissions[request.organizationRole] ?? [];
  return permissions.includes(permission);
}

function requirePermission(permission) {
  return (request, response, next) => {
    if (!hasPermission(request, permission)) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "This organization role does not have the required permission." } });
      return;
    }
    next();
  };
}

function requireOrganizationAdmin(request, response, next) {
  if (!["OWNER", "ADMIN"].includes(request.organizationRole)) {
    response.status(403).json({ error: { code: "FORBIDDEN", message: "An organization owner or admin is required." } });
    return;
  }
  next();
}

function requireMemberManager(request, response, next) {
  if (!["OWNER", "ADMIN"].includes(request.organizationRole) && !hasPermission(request, "MEMBER_MANAGE")) {
    response.status(403).json({ error: { code: "FORBIDDEN", message: "This organization role cannot manage members." } });
    return;
  }
  next();
}

function requireRoleManager(request, response, next) {
  if (!["OWNER", "ADMIN"].includes(request.organizationRole) && !hasPermission(request, "ROLE_MANAGE")) {
    response.status(403).json({ error: { code: "FORBIDDEN", message: "This organization role cannot manage custom roles." } });
    return;
  }
  next();
}

function permissionsAreWithinActorRole(request, permissions) {
  if (["OWNER", "ADMIN"].includes(request.organizationRole)) return true;
  return permissions.every((permission) => hasPermission(request, permission));
}

function canAssignBuiltInRole(request, role) {
  if (role === "OWNER") return request.organizationRole === "OWNER";
  if (role === "ADMIN") return ["OWNER", "ADMIN"].includes(request.organizationRole);
  return permissionsAreWithinActorRole(request, builtInPermissions[role] ?? []);
}

async function findCustomRoleForOrganization(prisma, organizationId, customRoleId) {
  if (!customRoleId) return null;
  return prisma.organizationCustomRole.findFirst({
    where: { id: customRoleId, organizationId },
    select: { id: true, name: true, permissions: true },
  });
}

async function getTask(prisma, request) {
  return prisma.task.findFirst({
    where: {
      id: request.params.taskId,
      organizationId: request.organization.id,
      AND: [{ OR: [{ archivedAt: null }, { archivedAt: { isSet: false } }] }],
    },
    include: { assignee: { select: { name: true } } },
  });
}

async function getProject(prisma, request, includeDetails = false, includeArchived = false) {
  const where = {
    id: request.params.projectId,
    organizationId: request.organization.id,
  };
  if (!includeArchived) {
    where.AND = [{ OR: [{ archivedAt: null }, { archivedAt: { isSet: false } }] }];
  }
  return prisma.project.findFirst({
    where,
    include: includeDetails ? {
      owner: { select: { name: true } },
      milestones: { orderBy: { sortOrder: "asc" } },
      deliverables: { orderBy: { createdAt: "asc" } },
      risks: { orderBy: { createdAt: "asc" } },
    } : { owner: { select: { name: true } } },
  });
}

function toProjectData(data) {
  const result = { ...data };
  if (result.status) result.status = projectStatuses[result.status];
  if (Object.hasOwn(result, "startDate")) result.startDate = dateInput(result.startDate);
  if (Object.hasOwn(result, "dueDate")) result.dueDate = dateInput(result.dueDate);
  return result;
}

function toTaskData(data) {
  const result = { ...data };
  if (result.assignee !== undefined) {
    result.assigneeLabel = result.assignee;
    delete result.assignee;
  }
  if (result.priority) result.priority = taskPriorities[result.priority];
  if (result.status) result.status = taskStatuses[result.status];
  if (Object.hasOwn(result, "due")) {
    result.dueDate = dateInput(result.due);
    delete result.due;
  }
  if (Object.hasOwn(result, "dueDate")) result.dueDate = dateInput(result.dueDate);
  if (result.status === "DONE") result.completedAt = new Date();
  else if (result.status) result.completedAt = null;
  return result;
}

async function validateProjectReferences(prisma, request, data, response) {
  if (data.ownerId) {
    const ownerMembership = await prisma.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: request.organization.id,
          userId: data.ownerId,
        },
      },
    });
    if (!ownerMembership) {
      response.status(400).json({ error: { code: "INVALID_OWNER", message: "Project owner must be an organization member." } });
      return false;
    }
  }
  return true;
}

async function validateTaskReferences(prisma, request, data, response) {
  if (data.projectId) {
    const project = await prisma.project.findFirst({
      where: {
        id: data.projectId,
        organizationId: request.organization.id,
        OR: [{ archivedAt: null }, { archivedAt: { isSet: false } }],
      },
      select: { id: true },
    });
    if (!project) {
      response.status(400).json({ error: { code: "INVALID_PROJECT", message: "Project must belong to this organization." } });
      return false;
    }
  }
  if (data.assigneeId) {
    const assigneeMembership = await prisma.organizationMembership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: request.organization.id,
          userId: data.assigneeId,
        },
      },
    });
    if (!assigneeMembership) {
      response.status(400).json({ error: { code: "INVALID_ASSIGNEE", message: "Assignee must be an organization member." } });
      return false;
    }
  }
  return true;
}

function filtersFromQuery(request, model) {
  const search = typeof request.query.search === "string" ? request.query.search.trim() : "";
  const where = { organizationId: request.organization.id };
  if (request.query.includeArchived !== "true") {
    where.OR = [{ archivedAt: null }, { archivedAt: { isSet: false } }];
  }
  if (search) {
    const searchFilter = { OR: model === "task"
      ? [
        { title: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
        { assigneeLabel: { contains: search, mode: "insensitive" } },
      ]
      : [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { ownerLabel: { contains: search, mode: "insensitive" } },
      ] };
    if (where.OR) where.AND = [searchFilter];
    else where.OR = searchFilter.OR;
  }
  if (request.query.status && request.query.status !== "All") {
    const status = model === "task" ? taskStatuses[request.query.status] : projectStatuses[request.query.status];
    if (!status) return { invalidFilter: "status" };
    where.status = status;
  }
  if (model === "task") {
    if (request.query.priority) {
      const priority = taskPriorities[request.query.priority];
      if (!priority) return { invalidFilter: "priority" };
      where.priority = priority;
    }
    if (request.query.assigneeId) where.assigneeId = String(request.query.assigneeId);
    if (request.query.projectId) where.projectId = String(request.query.projectId);
  } else if (request.query.ownerId) {
    where.ownerId = String(request.query.ownerId);
  }
  return where;
}

function utcDayRange(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function activeOrganizationRecords(organizationId) {
  return {
    organizationId,
    OR: [{ archivedAt: null }, { archivedAt: { isSet: false } }],
  };
}

export function createApiRouter(prisma) {
  const router = Router();
  const withOrganization = resolveOrganization(prisma);

  router.get("/admin/monitoring", withOrganization, requireOrganizationAdmin, async (request, response) => {
    const organizationId = request.organization.id;
    const trafficScope = { OR: [{ organizationId }, { organizationId: null }] };
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [events, pageViews, pageViewCount, pageViewsToday] = await Promise.all([
      prisma.monitoringEvent.findMany({
        where: {
          organizationId,
          type: { in: ["LOGIN", "ACCOUNT_CREATED", "PASSWORD_CHANGED"] },
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          actor: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.monitoringEvent.findMany({
        where: { ...trafficScope, type: "PAGE_VIEW" },
        include: {
          user: { select: { id: true, name: true, email: true } },
          organization: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      cachedCount(`count:pv:total:${organizationId}`, 15_000, () =>
        prisma.monitoringEvent.count({
          where: { AND: [trafficScope, { type: "PAGE_VIEW" }] },
        }),
      ),
      cachedCount(`count:pv:today:${organizationId}:${today.toISOString()}`, 15_000, () =>
        prisma.monitoringEvent.count({
          where: {
            AND: [trafficScope, { type: "PAGE_VIEW" }, { createdAt: { gte: today } }],
          },
        }),
      ),
    ]);
    response.json({
      data: {
        events: events.map((event) => ({
          id: event.id,
          type: event.type,
          role: event.role,
          user: event.user,
          actor: event.actor,
          createdAt: event.createdAt.toISOString(),
        })),
        traffic: {
          totalPageViews: pageViewCount,
          pageViewsToday,
          recentPageViews: pageViews.map((event) => ({
            id: event.id,
            path: event.path,
            user: event.user,
            organization: event.organization,
            createdAt: event.createdAt.toISOString(),
          })),
        },
      },
    });
  });

  router.patch("/auth/me", async (request, response) => {
    const data = parseBody(profileSchema, request, response);
    if (!data) return;
    const user = await prisma.user.update({
      where: { id: response.locals.user.id },
      data,
      select: { id: true, email: true, name: true, timezone: true, preferences: true },
    });
    await invalidateSession(response.locals.sessionTokenHash);
    response.json({ user });
  });

  router.post("/organizations", async (request, response) => {
    const data = parseBody(organizationSchema, request, response);
    if (!data) return;
    const organization = await prisma.organization.create({
      data: {
        name: data.name,
        slug: makeSlug(data.name),
        memberships: { create: { userId: response.locals.user.id, role: "OWNER" } },
      },
      select: { id: true, name: true, slug: true, createdAt: true },
    });
    await invalidateUserSessions(response.locals.sessionUserId);
    response.status(201).json({ data: { ...organization, role: "Owner" } });
  });

  router.get("/organizations/:organizationId", withOrganization, requirePermission("MEMBER_READ"), (request, response) => {
    response.json({
      data: {
        id: request.organization.id,
        name: request.organization.name,
        slug: request.organization.slug,
        role: roleLabels[request.organizationRole],
        createdAt: request.organization.createdAt.toISOString(),
      },
    });
  });

  router.patch("/organizations/:organizationId", withOrganization, requireOrganizationAdmin, async (request, response) => {
    const data = parseBody(organizationUpdateSchema, request, response);
    if (!data) return;
    const organization = await prisma.organization.update({
      where: { id: request.organization.id },
      data,
      select: { id: true, name: true, slug: true, updatedAt: true },
    });
    await invalidateOrganizationCache(prisma, request.organization.id);
    response.json({ data });
  });

  router.get("/organizations/:organizationId/roles/permissions", withOrganization, requireMemberManager, (_request, response) => {
    response.json({
      data: rolePermissionKeys.map((id) => ({ id, label: permissionLabels[id] })),
    });
  });

  router.get("/organizations/:organizationId/roles", withOrganization, requireMemberManager, async (request, response) => {
    const [memberships, customRoles] = await Promise.all([
      prisma.organizationMembership.findMany({
        where: { organizationId: request.organization.id },
        select: { role: true, customRoleId: true },
      }),
      prisma.organizationCustomRole.findMany({
        where: { organizationId: request.organization.id },
        orderBy: { name: "asc" },
      }),
    ]);
    const builtInCounts = Object.fromEntries(organizationRoles.map((role) => [role, 0]));
    const customCounts = new Map();
    for (const membership of memberships) {
      if (membership.customRoleId) {
        customCounts.set(membership.customRoleId, (customCounts.get(membership.customRoleId) ?? 0) + 1);
      } else {
        builtInCounts[membership.role] += 1;
      }
    }
    response.json({
      data: [
        ...organizationRoles.map((role) => ({
          id: role,
          name: roleLabels[role],
          description: "",
          builtIn: true,
          memberCount: builtInCounts[role],
          permissions: builtInPermissions[role],
        })),
        ...customRoles.map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          builtIn: false,
          memberCount: customCounts.get(role.id) ?? 0,
          permissions: role.permissions,
          createdAt: role.createdAt.toISOString(),
          updatedAt: role.updatedAt.toISOString(),
        })),
      ],
    });
  });

  router.post("/organizations/:organizationId/roles", withOrganization, requireRoleManager, async (request, response) => {
    const data = parseBody(customRoleCreateSchema, request, response);
    if (!data) return;
    if (!permissionsAreWithinActorRole(request, data.permissions)) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "Custom roles cannot grant permissions the actor does not have." } });
      return;
    }
    const existingNames = await prisma.organizationCustomRole.findMany({
      where: { organizationId: request.organization.id },
      select: { name: true },
    });
    if (existingNames.some((role) => role.name.toLowerCase() === data.name.toLowerCase())) {
      response.status(409).json({ error: { code: "ROLE_NAME_ALREADY_EXISTS", message: "A custom role with this name already exists." } });
      return;
    }
    const role = await prisma.organizationCustomRole.create({
      data: {
        organizationId: request.organization.id,
        name: data.name,
        description: data.description,
        permissions: [...new Set(data.permissions)],
      },
    });
    await prisma.auditEvent.create({
      data: {
        organizationId: request.organization.id,
        actorId: response.locals.user.id,
        action: "CUSTOM_ROLE_CREATED",
        targetType: "CUSTOM_ROLE",
        targetId: role.id,
        metadata: { name: role.name, permissions: role.permissions },
      },
    });
    response.status(201).json({
      data: {
        id: role.id,
        name: role.name,
        description: role.description,
        builtIn: false,
        memberCount: 0,
        permissions: role.permissions,
        createdAt: role.createdAt.toISOString(),
        updatedAt: role.updatedAt.toISOString(),
      },
    });
  });

  router.patch("/organizations/:organizationId/roles/:roleId", withOrganization, requireRoleManager, async (request, response) => {
    const data = parseBody(customRoleUpdateSchema, request, response);
    if (!data) return;
    const current = await prisma.organizationCustomRole.findFirst({
      where: { id: request.params.roleId, organizationId: request.organization.id },
    });
    if (!current) {
      response.status(404).json({ error: { code: "CUSTOM_ROLE_NOT_FOUND", message: "Custom role not found." } });
      return;
    }
    const nextPermissions = data.permissions ?? current.permissions;
    if (!permissionsAreWithinActorRole(request, nextPermissions)) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "Custom roles cannot grant permissions the actor does not have." } });
      return;
    }
    if (data.name !== undefined) {
      const existingNames = await prisma.organizationCustomRole.findMany({
        where: { organizationId: request.organization.id, id: { not: current.id } },
        select: { name: true },
      });
      if (existingNames.some((role) => role.name.toLowerCase() === data.name.toLowerCase())) {
        response.status(409).json({ error: { code: "ROLE_NAME_ALREADY_EXISTS", message: "A custom role with this name already exists." } });
        return;
      }
    }
    const updated = await prisma.organizationCustomRole.update({
      where: { id: current.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.permissions !== undefined ? { permissions: [...new Set(data.permissions)] } : {}),
      },
    });
    await invalidateOrganizationCache(prisma, request.organization.id);
    await prisma.auditEvent.create({
      data: {
        organizationId: request.organization.id,
        actorId: response.locals.user.id,
        action: "CUSTOM_ROLE_UPDATED",
        targetType: "CUSTOM_ROLE",
        targetId: updated.id,
        metadata: { name: updated.name, permissions: updated.permissions },
      },
    });
    response.json({
      data: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        builtIn: false,
        permissions: updated.permissions,
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  });

  router.delete("/organizations/:organizationId/roles/:roleId", withOrganization, requireRoleManager, async (request, response) => {
    const role = await prisma.organizationCustomRole.findFirst({
      where: { id: request.params.roleId, organizationId: request.organization.id },
      select: { id: true, name: true, permissions: true },
    });
    if (!role) {
      response.status(404).json({ error: { code: "CUSTOM_ROLE_NOT_FOUND", message: "Custom role not found." } });
      return;
    }
    const assignedCount = await prisma.organizationMembership.count({ where: { organizationId: request.organization.id, customRoleId: role.id } });
    if (assignedCount > 0) {
      response.status(409).json({ error: { code: "CUSTOM_ROLE_IN_USE", message: "Reassign members before deleting this role." } });
      return;
    }
    await prisma.$transaction(async (transaction) => {
      await transaction.auditEvent.create({
        data: {
          organizationId: request.organization.id,
          actorId: response.locals.user.id,
          action: "CUSTOM_ROLE_DELETED",
          targetType: "CUSTOM_ROLE",
          targetId: role.id,
          metadata: { name: role.name, permissions: role.permissions },
        },
      });
      await transaction.organizationCustomRole.delete({ where: { id: role.id } });
    });
    await invalidateOrganizationCache(prisma, request.organization.id);
    response.status(204).end();
  });

  router.get(["/organizations/:organizationId/members", "/members"], withOrganization, requirePermission("MEMBER_READ"), async (request, response) => {
    const pagination = parsePagination(request, response);
    if (!pagination) return;
    const where = { organizationId: request.organization.id };
    const [memberships, total] = await Promise.all([
      prisma.organizationMembership.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, timezone: true, createdAt: true } },
          customRole: { select: { id: true, name: true } },
        },
        orderBy: { joinedAt: "asc" },
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      prisma.organizationMembership.count({ where }),
    ]);
    paginatedResponse(response, memberships.map(({ id, role, joinedAt, user, customRole }) => ({
      id,
      user,
      role,
      roleLabel: customRole?.name ?? roleLabels[role],
      customRole: customRole ?? null,
      joinedAt: joinedAt.toISOString(),
    })), total, pagination);
  });

  router.post(["/organizations/:organizationId/members", "/members"], withOrganization, requireMemberManager, async (request, response) => {
    const data = parseBody(memberSchema, request, response);
    if (!data) return;
    if (!canAssignBuiltInRole(request, data.role) && !data.customRoleId) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "You cannot assign a built-in role with permissions or ownership privileges you do not have." } });
      return;
    }
    if (data.role === "OWNER" && request.organizationRole !== "OWNER") {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "Only an owner can grant the owner role." } });
      return;
    }
    if (data.role === "ADMIN" && !["OWNER", "ADMIN"].includes(request.organizationRole)) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "Only an owner or admin can grant the admin role." } });
      return;
    }
    if (data.customRoleId && ["OWNER", "ADMIN"].includes(data.role)) {
      response.status(400).json({ error: { code: "BUILT_IN_CUSTOM_ROLE_NOT_ALLOWED", message: "Custom roles cannot replace the built-in owner or admin role." } });
      return;
    }
    const customRole = data.customRoleId
      ? await findCustomRoleForOrganization(prisma, request.organization.id, data.customRoleId)
      : null;
    if (data.customRoleId && !customRole) {
      response.status(404).json({ error: { code: "CUSTOM_ROLE_NOT_FOUND", message: "Custom role not found in this organization." } });
      return;
    }
    if (customRole && !permissionsAreWithinActorRole(request, customRole.permissions)) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "You cannot assign a custom role with permissions you do not have." } });
      return;
    }
    const user = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
      select: { id: true, name: true, email: true },
    });
    if (!user) {
      response.status(404).json({ error: { code: "USER_NOT_FOUND", message: "No account exists for that email." } });
      return;
    }
    const existing = await prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId: request.organization.id, userId: user.id } },
    });
    if (existing) {
      response.status(409).json({ error: { code: "ALREADY_MEMBER", message: "This user already belongs to the organization." } });
      return;
    }
    const membership = await prisma.organizationMembership.create({
      data: { organizationId: request.organization.id, userId: user.id, role: data.role, customRoleId: customRole?.id },
    });
    await invalidateUserSessions(user.id);
    response.status(201).json({
      data: {
        id: membership.id,
        user,
        role: membership.role,
        roleLabel: customRole?.name ?? roleLabels[membership.role],
        customRole: customRole ? { id: customRole.id, name: customRole.name } : null,
      },
    });
  });

  router.post("/organizations/:organizationId/users", withOrganization, requireOrganizationAdmin, async (request, response) => {
    const data = parseBody(createUserSchema.extend({ customRoleId: z.string().min(1).optional() }), request, response);
    if (!data) return;
    if (!canAssignBuiltInRole(request, data.role) && !data.customRoleId) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "You cannot assign a built-in role with permissions or ownership privileges you do not have." } });
      return;
    }
    if (data.role === "OWNER" && request.organizationRole !== "OWNER") {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "Only an organization owner can create another owner." } });
      return;
    }
    if (data.role === "ADMIN" && !["OWNER", "ADMIN"].includes(request.organizationRole)) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "Only an owner or admin can create an admin." } });
      return;
    }
    if (data.customRoleId && ["OWNER", "ADMIN"].includes(data.role)) {
      response.status(400).json({ error: { code: "BUILT_IN_CUSTOM_ROLE_NOT_ALLOWED", message: "Custom roles cannot replace the built-in owner or admin role." } });
      return;
    }
    const customRole = data.customRoleId
      ? await findCustomRoleForOrganization(prisma, request.organization.id, data.customRoleId)
      : null;
    if (data.customRoleId && !customRole) {
      response.status(404).json({ error: { code: "CUSTOM_ROLE_NOT_FOUND", message: "Custom role not found in this organization." } });
      return;
    }
    if (customRole && !permissionsAreWithinActorRole(request, customRole.permissions)) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "You cannot assign a custom role with permissions you do not have." } });
      return;
    }
    const created = await createOrganizationUser(prisma, {
      ...data,
      organizationId: request.organization.id,
      actorId: response.locals.user.id,
      customRoleId: customRole?.id,
    });
    if (created.conflict) {
      response.status(409).json({ error: { code: "EMAIL_ALREADY_REGISTERED", message: "An account with this email already exists." } });
      return;
    }
    response.status(201).json({
      data: {
        ...created.user,
        membership: {
          ...created.membership,
          roleLabel: customRole?.name ?? roleLabels[created.membership.role],
          customRole: customRole ? { id: customRole.id, name: customRole.name } : null,
        },
      },
    });
  });

  router.patch(["/organizations/:organizationId/members/:memberId", "/members/:memberId"], withOrganization, requireMemberManager, async (request, response) => {
    const data = parseBody(memberUpdateSchema, request, response);
    if (!data) return;
    const membership = await prisma.organizationMembership.findFirst({
      where: { id: request.params.memberId, organizationId: request.organization.id },
    });
    if (!membership) {
      response.status(404).json({ error: { code: "MEMBER_NOT_FOUND", message: "Organization member not found." } });
      return;
    }
    if (membership.role === "OWNER" && request.organizationRole !== "OWNER") {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "Only an owner can change another owner's role." } });
      return;
    }
    const nextRole = data.role ?? membership.role;
    if (membership.role === "OWNER" && data.role !== undefined && data.role !== "OWNER") {
      const ownerCount = await prisma.organizationMembership.count({
        where: { organizationId: request.organization.id, role: "OWNER" },
      });
      if (ownerCount <= 1) {
        response.status(400).json({ error: { code: "LAST_OWNER", message: "An organization must always have an owner." } });
        return;
      }
    }
    let nextCustomRoleId = membership.customRoleId;
    if (Object.hasOwn(data, "customRoleId")) {
      if (["OWNER", "ADMIN"].includes(membership.role) && data.customRoleId) {
        response.status(400).json({ error: { code: "BUILT_IN_CUSTOM_ROLE_NOT_ALLOWED", message: "Custom roles cannot replace the built-in owner or admin role." } });
        return;
      }
      const customRole = data.customRoleId
        ? await findCustomRoleForOrganization(prisma, request.organization.id, data.customRoleId)
        : null;
      if (data.customRoleId && !customRole) {
        response.status(404).json({ error: { code: "CUSTOM_ROLE_NOT_FOUND", message: "Custom role not found in this organization." } });
        return;
      }
      if (customRole && !permissionsAreWithinActorRole(request, customRole.permissions)) {
        response.status(403).json({ error: { code: "FORBIDDEN", message: "You cannot assign a custom role with permissions you do not have." } });
        return;
      }
      nextCustomRoleId = customRole?.id ?? null;
    } else if (data.role !== undefined) {
      nextCustomRoleId = null;
    }
    if (["OWNER", "ADMIN"].includes(nextRole) && nextCustomRoleId) {
      response.status(400).json({ error: { code: "BUILT_IN_CUSTOM_ROLE_NOT_ALLOWED", message: "Custom roles cannot replace the built-in owner or admin role." } });
      return;
    }
    if (!nextCustomRoleId && !canAssignBuiltInRole(request, nextRole)) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "You cannot assign a built-in role with permissions or ownership privileges you do not have." } });
      return;
    }
    const updated = await prisma.organizationMembership.update({
      where: { id: membership.id },
      data: {
        ...(data.role !== undefined ? { role: data.role } : {}),
        customRoleId: nextCustomRoleId,
      },
      include: { customRole: { select: { id: true, name: true } } },
    });
    await invalidateMembership(membership.userId, request.organization.id);
    await invalidateUserSessions(membership.userId);
    response.json({
      data: {
        id: updated.id,
        role: updated.role,
        roleLabel: updated.customRole?.name ?? roleLabels[updated.role],
        customRole: updated.customRole ?? null,
      },
    });
  });

  router.delete(["/organizations/:organizationId/members/:memberId", "/members/:memberId"], withOrganization, requireMemberManager, async (request, response) => {
    const membership = await prisma.organizationMembership.findFirst({
      where: { id: request.params.memberId, organizationId: request.organization.id },
    });
    if (!membership) {
      response.status(404).json({ error: { code: "MEMBER_NOT_FOUND", message: "Organization member not found." } });
      return;
    }
    if (membership.userId === response.locals.user.id) {
      response.status(400).json({ error: { code: "CANNOT_REMOVE_SELF", message: "You cannot remove your own membership." } });
      return;
    }
    if (membership.role === "OWNER") {
      response.status(400).json({ error: { code: "OWNER_TRANSFER_REQUIRED", message: "Transfer ownership before removing an owner." } });
      return;
    }
    if (membership.role === "ADMIN" && !["OWNER", "ADMIN"].includes(request.organizationRole)) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "Only an owner or admin can remove an admin." } });
      return;
    }
    await prisma.organizationMembership.delete({ where: { id: membership.id } });
    await invalidateMembership(membership.userId, request.organization.id);
    await invalidateUserSessions(membership.userId);
    response.status(204).end();
  });

  const listProjects = async (request, response) => {
    const pagination = parsePagination(request, response);
    if (!pagination) return;
    const where = filtersFromQuery(request, "project");
    if (where.invalidFilter) {
      sendValidationError(response, [{ path: ["query", where.invalidFilter], message: `Unsupported ${where.invalidFilter} filter.` }]);
      return;
    }
    const sortField = request.query.sort === "name" ? "name" : request.query.sort === "createdAt" ? "createdAt" : "updatedAt";
    const sortOrder = request.query.order === "asc" ? "asc" : "desc";
    const [records, total] = await Promise.all([
      prisma.project.findMany({
        where,
        include: { owner: { select: { name: true } } },
        orderBy: { [sortField]: sortOrder },
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      prisma.project.count({ where }),
    ]);
    paginatedResponse(response, records.map(projectResponse), total, pagination);
  };
  router.get("/organizations/:organizationId/projects", withOrganization, requirePermission("PROJECT_READ"), listProjects);
  router.get("/projects", withOrganization, requirePermission("PROJECT_READ"), listProjects);

  const createProject = async (request, response) => {
    const data = parseBody(projectCreateSchema, request, response);
    if (!data) return;
    const projectData = toProjectData(data);
    if (!await validateProjectReferences(prisma, request, projectData, response)) return;
    const project = await prisma.project.create({
      data: {
        ...projectData,
        organizationId: request.organization.id,
        createdById: response.locals.user.id,
      },
      include: { owner: { select: { name: true } } },
    });
    response.status(201).json({ data: projectResponse(project) });
  };
  router.post("/organizations/:organizationId/projects", withOrganization, requirePermission("PROJECT_WRITE"), createProject);
  router.post("/projects", withOrganization, requirePermission("PROJECT_WRITE"), createProject);

  const readProject = async (request, response) => {
    if (request.params.projectId === "summary") {
      return projectSummary(request, response);
    }
    const project = await getProject(prisma, request, true);
    if (!project) {
      response.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } });
      return;
    }
    response.json({
      data: {
        ...projectResponse(project),
        milestones: project.milestones.map((item) => ({
          id: item.id,
          label: item.title,
          done: Boolean(item.completedAt),
          dueDate: item.dueDate?.toISOString() ?? null,
        })),
        deliverables: project.deliverables.map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          completed: Boolean(item.completedAt),
        })),
        risks: project.risks.map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          resolved: Boolean(item.resolvedAt),
        })),
      },
    });
  };
  router.get(["/organizations/:organizationId/projects/:projectId", "/projects/:projectId"], withOrganization, requirePermission("PROJECT_READ"), readProject);

  const updateProject = async (request, response) => {
    const data = parseBody(projectSchema, request, response);
    if (!data) return;
    const existing = await getProject(prisma, request);
    if (!existing) {
      response.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } });
      return;
    }
    const projectData = toProjectData(data);
    if (!await validateProjectReferences(prisma, request, projectData, response)) return;
    const project = await prisma.project.update({
      where: { id: existing.id },
      data: projectData,
      include: { owner: { select: { name: true } } },
    });
    response.json({ data: projectResponse(project) });
  };
  router.patch(["/organizations/:organizationId/projects/:projectId", "/projects/:projectId"], withOrganization, requirePermission("PROJECT_WRITE"), updateProject);

  const archiveProject = async (request, response) => {
    const project = await getProject(prisma, request);
    if (!project) {
      response.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } });
      return;
    }
    await prisma.project.update({ where: { id: project.id }, data: { archivedAt: new Date() } });
    response.status(204).end();
  };
  router.post(["/organizations/:organizationId/projects/:projectId/archive", "/projects/:projectId/archive"], withOrganization, requirePermission("PROJECT_WRITE"), archiveProject);

  const deleteProject = async (request, response) => {
    const project = await getProject(prisma, request, false, true);
    if (!project) {
      response.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } });
      return;
    }
    await prisma.project.delete({ where: { id: project.id } });
    response.status(204).end();
  };
  router.delete(["/organizations/:organizationId/projects/:projectId", "/projects/:projectId"], withOrganization, requirePermission("PROJECT_WRITE"), deleteProject);

  const projectChildResources = [
    {
      name: "milestones",
      delegate: "projectMilestone",
      schema: projectMilestoneSchema,
      createSchema: projectMilestoneSchema.extend({ title: z.string().trim().min(1).max(160) }),
      toData(data) {
        const result = { ...data };
        if (Object.hasOwn(result, "completed")) {
          result.completedAt = result.completed ? new Date() : null;
          delete result.completed;
        }
        if (Object.hasOwn(result, "dueDate")) result.dueDate = dateInput(result.dueDate);
        return result;
      },
      map(item) {
        return {
          id: item.id,
          title: item.title,
          label: item.title,
          dueDate: item.dueDate?.toISOString() ?? null,
          sortOrder: item.sortOrder,
          completed: Boolean(item.completedAt),
          done: Boolean(item.completedAt),
        };
      },
    },
    {
      name: "deliverables",
      delegate: "projectDeliverable",
      schema: projectDeliverableSchema,
      createSchema: projectDeliverableSchema.extend({ title: z.string().trim().min(1).max(160) }),
      toData(data) {
        const result = { ...data };
        if (Object.hasOwn(result, "completed")) {
          result.completedAt = result.completed ? new Date() : null;
          delete result.completed;
        }
        return result;
      },
      map(item) {
        return {
          id: item.id,
          title: item.title,
          description: item.description,
          completed: Boolean(item.completedAt),
        };
      },
    },
    {
      name: "risks",
      delegate: "projectRisk",
      schema: projectRiskSchema,
      createSchema: projectRiskSchema.extend({ title: z.string().trim().min(1).max(160) }),
      toData(data) {
        const result = { ...data };
        if (Object.hasOwn(result, "resolved")) {
          result.resolvedAt = result.resolved ? new Date() : null;
          delete result.resolved;
        }
        return result;
      },
      map(item) {
        return {
          id: item.id,
          title: item.title,
          description: item.description,
          resolved: Boolean(item.resolvedAt),
        };
      },
    },
  ];

  for (const resource of projectChildResources) {
    const basePaths = [
      `/organizations/:organizationId/projects/:projectId/${resource.name}`,
      `/projects/:projectId/${resource.name}`,
    ];
    const itemPaths = basePaths.map((path) => `${path}/:itemId`);
    const delegate = prisma[resource.delegate];

    router.get(basePaths, withOrganization, requirePermission("PROJECT_READ"), async (request, response) => {
      const project = await getProject(prisma, request);
      if (!project) {
        response.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } });
        return;
      }
      const records = await delegate.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: "asc" },
      });
      response.json({ data: records.map(resource.map) });
    });

    router.post(basePaths, withOrganization, requirePermission("PROJECT_WRITE"), async (request, response) => {
      const data = parseBody(resource.createSchema, request, response);
      if (!data) return;
      const project = await getProject(prisma, request);
      if (!project) {
        response.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } });
        return;
      }
      const record = await delegate.create({
        data: { ...resource.toData(data), projectId: project.id },
      });
      response.status(201).json({ data: resource.map(record) });
    });

    router.patch(itemPaths, withOrganization, requirePermission("PROJECT_WRITE"), async (request, response) => {
      const data = parseBody(resource.schema.refine((value) => Object.keys(value).length > 0), request, response);
      if (!data) return;
      const project = await getProject(prisma, request);
      if (!project) {
        response.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } });
        return;
      }
      const existing = await delegate.findFirst({ where: { id: request.params.itemId, projectId: project.id } });
      if (!existing) {
        response.status(404).json({ error: { code: "NOT_FOUND", message: `${resource.name.slice(0, -1)} not found.` } });
        return;
      }
      const record = await delegate.update({
        where: { id: existing.id },
        data: resource.toData(data),
      });
      response.json({ data: resource.map(record) });
    });

    router.delete(itemPaths, withOrganization, requirePermission("PROJECT_WRITE"), async (request, response) => {
      const project = await getProject(prisma, request);
      if (!project) {
        response.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found." } });
        return;
      }
      const existing = await delegate.findFirst({ where: { id: request.params.itemId, projectId: project.id } });
      if (!existing) {
        response.status(404).json({ error: { code: "NOT_FOUND", message: `${resource.name.slice(0, -1)} not found.` } });
        return;
      }
      await delegate.delete({ where: { id: existing.id } });
      response.status(204).end();
    });
  }

  const listTasks = async (request, response) => {
    const pagination = parsePagination(request, response);
    if (!pagination) return;
    const where = filtersFromQuery(request, "task");
    if (where.invalidFilter) {
      sendValidationError(response, [{ path: ["query", where.invalidFilter], message: `Unsupported ${where.invalidFilter} filter.` }]);
      return;
    }
    const sortField = ["title", "dueDate", "createdAt", "updatedAt", "priority", "status"].includes(String(request.query.sort))
      ? String(request.query.sort)
      : "updatedAt";
    const sortOrder = request.query.order === "asc" ? "asc" : "desc";
    const [records, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include: { assignee: { select: { name: true } } },
        orderBy: { [sortField]: sortOrder },
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      prisma.task.count({ where }),
    ]);
    paginatedResponse(response, records.map(taskResponse), total, pagination);
  };
  router.get("/organizations/:organizationId/tasks", withOrganization, requirePermission("TASK_READ"), listTasks);
  router.get("/tasks", withOrganization, requirePermission("TASK_READ"), listTasks);

  const createTask = async (request, response) => {
    const data = parseBody(taskCreateSchema, request, response);
    if (!data) return;
    const taskData = toTaskData(data);
    if (Object.hasOwn(taskData, "dueDate") && taskData.dueDate === undefined) {
      sendValidationError(response, [{ path: ["body", "due"], message: "Due date must be a valid date or supported label." }]);
      return;
    }
    if (!await validateTaskReferences(prisma, request, taskData, response)) return;
    const task = await prisma.task.create({
      data: {
        ...taskData,
        organizationId: request.organization.id,
        createdById: response.locals.user.id,
      },
      include: { assignee: { select: { name: true } } },
    });
    response.status(201).json({ data: taskResponse(task) });
  };
  router.post("/organizations/:organizationId/tasks", withOrganization, requirePermission("TASK_WRITE"), createTask);
  router.post("/tasks", withOrganization, requirePermission("TASK_WRITE"), createTask);

  const readTask = async (request, response) => {
    if (request.params.taskId === "summary") {
      return taskSummary(request, response);
    }
    const task = await getTask(prisma, request);
    if (!task) {
      response.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found." } });
      return;
    }
    response.json({ data: taskResponse(task) });
  };
  router.get(["/organizations/:organizationId/tasks/:taskId", "/tasks/:taskId"], withOrganization, requirePermission("TASK_READ"), readTask);

  const updateTask = async (request, response) => {
    const data = parseBody(taskSchema, request, response);
    if (!data) return;
    const existing = await getTask(prisma, request);
    if (!existing) {
      response.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found." } });
      return;
    }
    const taskData = toTaskData(data);
    if (Object.hasOwn(taskData, "dueDate") && taskData.dueDate === undefined) {
      sendValidationError(response, [{ path: ["body", "due"], message: "Due date must be a valid date or supported label." }]);
      return;
    }
    if (!await validateTaskReferences(prisma, request, taskData, response)) return;
    const task = await prisma.task.update({
      where: { id: existing.id },
      data: taskData,
      include: { assignee: { select: { name: true } } },
    });
    response.json({ data: taskResponse(task) });
  };
  router.patch(["/organizations/:organizationId/tasks/:taskId", "/tasks/:taskId"], withOrganization, requirePermission("TASK_WRITE"), updateTask);

  const deleteTask = async (request, response) => {
    const task = await prisma.task.findFirst({
      where: { id: request.params.taskId, organizationId: request.organization.id },
      include: { assignee: { select: { name: true } } },
    });
    if (!task) {
      response.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found." } });
      return;
    }
    await prisma.task.delete({ where: { id: task.id } });
    response.status(204).end();
  };
  router.delete(["/organizations/:organizationId/tasks/:taskId", "/tasks/:taskId"], withOrganization, requirePermission("TASK_WRITE"), deleteTask);

  const archiveTask = async (request, response) => {
    const task = await getTask(prisma, request);
    if (!task) {
      response.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found." } });
      return;
    }
    await prisma.task.update({ where: { id: task.id }, data: { archivedAt: new Date() } });
    response.status(204).end();
  };
  router.post([
    "/organizations/:organizationId/tasks/:taskId/archive",
    "/tasks/:taskId/archive",
  ], withOrganization, requirePermission("TASK_WRITE"), archiveTask);

  const listComments = async (request, response) => {
    const task = await getTask(prisma, request);
    if (!task) {
      response.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found." } });
      return;
    }
    const comments = await prisma.taskComment.findMany({
      where: { organizationId: request.organization.id, taskId: task.id },
      include: { author: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
    response.json({ data: comments });
  };
  router.get([
    "/organizations/:organizationId/tasks/:taskId/comments",
    "/tasks/:taskId/comments",
  ], withOrganization, requirePermission("TASK_READ"), listComments);

  const createComment = async (request, response) => {
    const data = parseBody(commentSchema, request, response);
    if (!data) return;
    const task = await getTask(prisma, request);
    if (!task) {
      response.status(404).json({ error: { code: "NOT_FOUND", message: "Task not found." } });
      return;
    }
    const comment = await prisma.taskComment.create({
      data: {
        ...data,
        organizationId: request.organization.id,
        taskId: task.id,
        authorId: response.locals.user.id,
      },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
    response.status(201).json({ data: comment });
  };
  router.post([
    "/organizations/:organizationId/tasks/:taskId/comments",
    "/tasks/:taskId/comments",
  ], withOrganization, requirePermission("TASK_WRITE"), createComment);

  const updateComment = async (request, response) => {
    const data = parseBody(commentSchema, request, response);
    if (!data) return;
    const comment = await prisma.taskComment.findFirst({
      where: {
        id: request.params.commentId,
        taskId: request.params.taskId,
        organizationId: request.organization.id,
      },
    });
    if (!comment) {
      response.status(404).json({ error: { code: "NOT_FOUND", message: "Comment not found." } });
      return;
    }
    if (comment.authorId !== response.locals.user.id && !hasPermission(request, "COMMENT_MODERATE")) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "Only the comment author or an organization admin can edit this comment." } });
      return;
    }
    const updated = await prisma.taskComment.update({
      where: { id: comment.id },
      data,
      include: { author: { select: { id: true, name: true, email: true } } },
    });
    response.json({ data: updated });
  };
  router.patch([
    "/organizations/:organizationId/tasks/:taskId/comments/:commentId",
    "/tasks/:taskId/comments/:commentId",
  ], withOrganization, updateComment);

  const deleteComment = async (request, response) => {
    const comment = await prisma.taskComment.findFirst({
      where: {
        id: request.params.commentId,
        taskId: request.params.taskId,
        organizationId: request.organization.id,
      },
    });
    if (!comment) {
      response.status(404).json({ error: { code: "NOT_FOUND", message: "Comment not found." } });
      return;
    }
    if (comment.authorId !== response.locals.user.id && !hasPermission(request, "COMMENT_MODERATE")) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "Only the comment author or an organization admin can remove this comment." } });
      return;
    }
    await prisma.taskComment.delete({ where: { id: comment.id } });
    response.status(204).end();
  };
  router.delete([
    "/organizations/:organizationId/tasks/:taskId/comments/:commentId",
    "/tasks/:taskId/comments/:commentId",
  ], withOrganization, deleteComment);

  const listNotifications = async (request, response) => {
    const pagination = parsePagination(request, response);
    if (!pagination) return;
    const where = {
      organizationId: request.organization.id,
      userId: response.locals.user.id,
    };
    const filters = [];
    if (request.query.dismissed === "true") where.dismissedAt = { not: null };
    else filters.push({ OR: [{ dismissedAt: null }, { dismissedAt: { isSet: false } }] });
    if (request.query.read === "true") where.readAt = { not: null };
    else if (request.query.read === "false") filters.push({ OR: [{ readAt: null }, { readAt: { isSet: false } }] });
    if (filters.length) where.AND = filters;
    const [records, total, unread] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: {
          organizationId: request.organization.id,
          userId: response.locals.user.id,
          AND: [
            { OR: [{ readAt: null }, { readAt: { isSet: false } }] },
            { OR: [{ dismissedAt: null }, { dismissedAt: { isSet: false } }] },
          ],
        },
      }),
    ]);
    paginatedResponse(response, records, total, pagination, { unread });
  };
  router.get("/organizations/:organizationId/notifications", withOrganization, requirePermission("NOTIFICATION_READ"), listNotifications);
  router.get("/notifications", withOrganization, requirePermission("NOTIFICATION_READ"), listNotifications);

  const updateNotification = async (request, response) => {
    const data = parseBody(notificationUpdateSchema, request, response);
    if (!data) return;
    const notification = await prisma.notification.findFirst({
      where: {
        id: request.params.notificationId,
        organizationId: request.organization.id,
        userId: response.locals.user.id,
      },
    });
    if (!notification) {
      response.status(404).json({ error: { code: "NOT_FOUND", message: "Notification not found." } });
      return;
    }
    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: {
        ...(data.read !== undefined ? { readAt: data.read ? new Date() : null } : {}),
        ...(data.dismissed !== undefined ? { dismissedAt: data.dismissed ? new Date() : null } : {}),
      },
    });
    response.json({ data: updated });
  };
  router.patch([
    "/organizations/:organizationId/notifications/:notificationId",
    "/notifications/:notificationId",
  ], withOrganization, requirePermission("NOTIFICATION_MANAGE"), updateNotification);
  router.post([
    "/organizations/:organizationId/notifications/:notificationId/read",
    "/notifications/:notificationId/read",
  ], withOrganization, requirePermission("NOTIFICATION_MANAGE"), async (request, response) => {
    request.body = { read: true };
    await updateNotification(request, response);
  });
  router.post([
    "/organizations/:organizationId/notifications/:notificationId/dismiss",
    "/notifications/:notificationId/dismiss",
  ], withOrganization, requirePermission("NOTIFICATION_MANAGE"), async (request, response) => {
    request.body = { dismissed: true };
    await updateNotification(request, response);
  });

  const listActivity = async (request, response) => {
    const pagination = parsePagination(request, response);
    if (!pagination) return;
    const where = { organizationId: request.organization.id };
    if (typeof request.query.targetType === "string") where.targetType = request.query.targetType;
    if (typeof request.query.targetId === "string") where.targetId = request.query.targetId;
    const [records, total] = await Promise.all([
      prisma.activityEvent.findMany({
        where,
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      prisma.activityEvent.count({ where }),
    ]);
    paginatedResponse(response, records, total, pagination);
  };
  router.get("/organizations/:organizationId/activity", withOrganization, requirePermission("AUDIT_READ"), listActivity);
  router.get("/activity", withOrganization, requirePermission("AUDIT_READ"), listActivity);

  const taskSummary = async (request, response) => {
    const organizationId = request.organization.id;
    const activeTasks = activeOrganizationRecords(organizationId);
    const { start, end } = utcDayRange(new Date());
    const [total, completed, dueToday, byStatus, byPriority] = await Promise.all([
      prisma.task.count({ where: activeTasks }),
      prisma.task.count({ where: { ...activeTasks, status: "DONE" } }),
      prisma.task.count({
        where: { ...activeTasks, dueDate: { gte: start, lt: end }, status: { not: "DONE" } },
      }),
      prisma.task.groupBy({ by: ["status"], where: activeTasks, _count: { _all: true } }),
      prisma.task.groupBy({ by: ["priority"], where: activeTasks, _count: { _all: true } }),
    ]);
    response.json({
      data: {
        total,
        open: total - completed,
        completed,
        dueToday,
        byStatus: Object.fromEntries(byStatus.map(({ status, _count }) => [taskStatusLabels[status], _count._all])),
        byPriority: Object.fromEntries(byPriority.map(({ priority, _count }) => [taskPriorityLabels[priority], _count._all])),
      },
    });
  };
  router.get(["/organizations/:organizationId/tasks/summary", "/tasks/summary"], withOrganization, requirePermission("ANALYTICS_READ"), taskSummary);

  const projectSummary = async (request, response) => {
    const organizationId = request.organization.id;
    const activeProjects = activeOrganizationRecords(organizationId);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const [total, byStatus, portfolioValue, progress, milestonesDueThisMonth] = await Promise.all([
      prisma.project.count({ where: activeProjects }),
      prisma.project.groupBy({ by: ["status"], where: activeProjects, _count: { _all: true } }),
      prisma.project.aggregate({ where: activeProjects, _sum: { valueAmount: true } }),
      prisma.project.aggregate({ where: activeProjects, _avg: { progress: true } }),
      prisma.projectMilestone.count({
        where: {
          project: { organizationId },
          dueDate: { gte: monthStart, lt: nextMonthStart },
          OR: [{ completedAt: null }, { completedAt: { isSet: false } }],
        },
      }),
    ]);
    response.json({
      data: {
        total,
        byStatus: Object.fromEntries(byStatus.map(({ status, _count }) => [projectStatusLabels[status], _count._all])),
        portfolioValue: portfolioValue._sum.valueAmount ?? 0,
        averageProgress: Math.round(progress._avg.progress ?? 0),
        milestonesDueThisMonth,
      },
    });
  };
  router.get(["/organizations/:organizationId/projects/summary", "/projects/summary"], withOrganization, requirePermission("ANALYTICS_READ"), projectSummary);

  const dashboardOverview = async (request, response) => {
    const organizationId = request.organization.id;
    const activeTasks = activeOrganizationRecords(organizationId);
    const activeProjects = activeOrganizationRecords(organizationId);
    const now = new Date();
    const { start: todayStart, end: todayEnd } = utcDayRange(now);
    const weekStart = new Date(todayStart);
    weekStart.setUTCDate(weekStart.getUTCDate() - 6);

    const dailyThroughputQueries = Array.from({ length: 7 }, (_, index) => {
      const dayStart = new Date(weekStart);
      dayStart.setUTCDate(dayStart.getUTCDate() + index);
      const dayEnd = new Date(dayStart);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
      return prisma.task.count({
        where: {
          organizationId,
          status: "DONE",
          completedAt: { gte: dayStart, lt: dayEnd },
        },
      }).then((completed) => ({
        date: dayStart.toISOString().slice(0, 10),
        day: dayStart.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
        completed,
      }));
    });

    const [
      projectsTotal,
      projectsAtRisk,
      projectsByStatus,
      taskTotal,
      completedTasks,
      dueToday,
      tasksByStatus,
      recentTasks,
      recentActivity,
      teamMemberships,
      unreadNotifications,
      weeklyThroughput,
    ] = await Promise.all([
      prisma.project.count({ where: activeProjects }),
      prisma.project.count({ where: { ...activeProjects, status: "AT_RISK" } }),
      prisma.project.groupBy({ by: ["status"], where: activeProjects, _count: { _all: true } }),
      prisma.task.count({ where: activeTasks }),
      prisma.task.count({ where: { ...activeTasks, status: "DONE" } }),
      prisma.task.count({
        where: { ...activeTasks, dueDate: { gte: todayStart, lt: todayEnd }, status: { not: "DONE" } },
      }),
      prisma.task.groupBy({ by: ["status"], where: activeTasks, _count: { _all: true } }),
      prisma.task.findMany({
        where: activeTasks,
        include: { assignee: { select: { name: true } } },
        orderBy: { updatedAt: "desc" },
        take: 8,
      }),
      prisma.activityEvent.findMany({
        where: { organizationId },
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
      prisma.organizationMembership.findMany({
        where: { organizationId },
        select: { userId: true, role: true },
        orderBy: { joinedAt: "asc" },
        take: 8,
      }),
      prisma.notification.count({
        where: {
          organizationId,
          userId: response.locals.user.id,
          AND: [
            { OR: [{ readAt: null }, { readAt: { isSet: false } }] },
            { OR: [{ dismissedAt: null }, { dismissedAt: { isSet: false } }] },
          ],
        },
      }),
      Promise.all(dailyThroughputQueries),
    ]);

    const teamUsers = teamMemberships.length === 0
      ? []
      : await prisma.user.findMany({
        where: { id: { in: teamMemberships.map(({ userId }) => userId) } },
        select: { id: true, name: true, email: true },
      });
    const teamUsersById = new Map(teamUsers.map((user) => [user.id, user]));

    response.json({
      data: {
        projects: {
          total: projectsTotal,
          atRisk: projectsAtRisk,
          byStatus: Object.fromEntries(projectsByStatus.map(({ status, _count }) => [projectStatusLabels[status], _count._all])),
        },
        tasks: {
          total: taskTotal,
          open: taskTotal - completedTasks,
          completed: completedTasks,
          dueToday,
          byStatus: Object.fromEntries(tasksByStatus.map(({ status, _count }) => [taskStatusLabels[status], _count._all])),
          recent: recentTasks.map(taskResponse),
        },
        weeklyThroughput,
        activity: recentActivity,
        team: teamMemberships.flatMap(({ role, userId }) => {
          const user = teamUsersById.get(userId);
          return user ? [{
            id: user.id,
            name: user.name,
            email: user.email,
            role: roleLabels[role],
          }] : [];
        }),
        notifications: { unread: unreadNotifications },
      },
    });
  };
  router.get(["/organizations/:organizationId/dashboard/overview", "/dashboard/overview"], withOrganization, requirePermission("ANALYTICS_READ"), dashboardOverview);

  router.get(["/organizations/:organizationId/audit", "/audit"], withOrganization, requirePermission("AUDIT_READ"), async (request, response) => {
    const pagination = parsePagination(request, response);
    if (!pagination) return;
    const where = { organizationId: request.organization.id };
    if (typeof request.query.targetType === "string") where.targetType = request.query.targetType;
    if (typeof request.query.targetId === "string") where.targetId = request.query.targetId;
    const [records, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      prisma.auditEvent.count({ where }),
    ]);
    paginatedResponse(response, records, total, pagination);
  });

  router.get(["/organizations/:organizationId/analytics/overview", "/analytics/overview"], withOrganization, requirePermission("ANALYTICS_READ"), async (request, response) => {
    const organizationId = request.organization.id;
    const activeRecords = {
      organizationId,
      OR: [{ archivedAt: null }, { archivedAt: { isSet: false } }],
    };
    const [projectTotal, atRiskProjects, taskTotal, completedTasks, openTasks, taskGroups] = await Promise.all([
      prisma.project.count({ where: activeRecords }),
      prisma.project.count({ where: { ...activeRecords, status: "AT_RISK" } }),
      prisma.task.count({ where: activeRecords }),
      prisma.task.count({ where: { ...activeRecords, status: "DONE" } }),
      prisma.task.count({ where: { ...activeRecords, status: { not: "DONE" } } }),
      prisma.task.groupBy({
        by: ["status"],
        where: activeRecords,
        _count: { _all: true },
      }),
    ]);
    response.json({
      data: {
        projects: { total: projectTotal, atRisk: atRiskProjects },
        tasks: { total: taskTotal, open: openTasks, completed: completedTasks },
        tasksByStatus: Object.fromEntries(taskGroups.map(({ status, _count }) => [taskStatusLabels[status], _count._all])),
      },
    });
  });

  return router;
}
