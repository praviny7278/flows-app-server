import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const demoEmail = "team@flowops.example";
const demoPassword = "password123";

async function main() {
  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const user = await prisma.user.upsert({
    where: { email: demoEmail },
    update: { name: "Ariana Patel", passwordHash },
    create: { email: demoEmail, name: "Ariana Patel", passwordHash, timezone: "America/Los_Angeles" },
  });

  const organization = await prisma.organization.upsert({
    where: { slug: "flowops-demo" },
    update: { name: "FlowOps Workspace" },
    create: { name: "FlowOps Workspace", slug: "flowops-demo" },
  });

  await prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
    update: { role: "OWNER" },
    create: { organizationId: organization.id, userId: user.id, role: "OWNER" },
  });

  const projectSeeds = [
    { id: "northstar-expansion", name: "Northstar Expansion", ownerLabel: "Ava Patel", status: "ON_TRACK", progress: 82, valueAmount: 145000 },
    { id: "client-onboarding", name: "Client Onboarding", ownerLabel: "Maya Holt", status: "AT_RISK", progress: 58, valueAmount: 82000 },
    { id: "customer-health-upgrade", name: "Customer Health Upgrade", ownerLabel: "Nora Lee", status: "REVIEW", progress: 74, valueAmount: 63000 },
    { id: "finance-automation", name: "Finance Automation", ownerLabel: "Kian Ross", status: "ON_TRACK", progress: 90, valueAmount: 112000 },
  ];

  for (const project of projectSeeds) {
    const { id, ...projectData } = project;
    await prisma.project.upsert({
      where: { id },
      update: { ...projectData, organizationId: organization.id, createdById: user.id, ownerId: user.id },
      create: { id, ...projectData, organizationId: organization.id, createdById: user.id, ownerId: user.id },
    });
  }

  const taskSeeds = [
    { id: "task-1", title: "Launch checklist review", assigneeLabel: "Ava", priority: "HIGH", status: "IN_REVIEW", progress: 76, dueDate: new Date("2026-10-01T12:00:00.000Z"), stage: "Ready for sign-off", notes: "Need final stakeholder sign-off, confirm launch sequence, and align marketing timeline before publishing the rollout plan." },
    { id: "task-2", title: "Vendor onboarding follow-up", assigneeLabel: "Marcus", priority: "MEDIUM", status: "QUEUED", progress: 42, dueDate: new Date("2026-10-02T12:00:00.000Z"), stage: "Waiting on legal", notes: "Follow up with legal and confirm the vendor paperwork is complete." },
    { id: "task-3", title: "Budget sign-off", assigneeLabel: "Kian", priority: "HIGH", status: "BLOCKED", progress: 24, dueDate: new Date("2026-10-03T12:00:00.000Z"), stage: "Finance approval", notes: "Waiting for finance approval before the work can continue." },
    { id: "task-4", title: "Ops documentation refresh", assigneeLabel: "Nora", priority: "LOW", status: "DONE", progress: 100, dueDate: null, stage: "Published", notes: "Documentation has been published to the workspace.", completedAt: new Date("2026-09-30T12:00:00.000Z") },
  ];

  for (const task of taskSeeds) {
    const { id, ...taskData } = task;
    await prisma.task.upsert({
      where: { id },
      update: { ...taskData, organizationId: organization.id, createdById: user.id },
      create: { id, ...taskData, organizationId: organization.id, createdById: user.id },
    });
  }

  console.log(`Seeded demo user ${demoEmail} in ${organization.name}.`);
}

main()
  .catch((error) => {
    console.error(error);
    throw error;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
