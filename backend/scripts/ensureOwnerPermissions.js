import 'dotenv/config';
import { disconnectPrisma, getPrisma } from '../src/providers/postgresProvider.js';

const OWNER_EMAIL = 'mert.omeroglu@shelfio.com';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const main = async () => {
  const prisma = await getPrisma();
  const user = await prisma.user.findFirst({
    where: { email: { equals: OWNER_EMAIL, mode: 'insensitive' } },
  });

  if (!user) {
    console.log(JSON.stringify({
      ok: true,
      changed: false,
      reason: 'OWNER_USER_NOT_FOUND',
      email: OWNER_EMAIL,
    }, null, 2));
    return;
  }

  const updates = {};
  if (user.role !== 'admin') updates.role = 'admin';
  if (user.department !== 'Yönetim') updates.department = 'Yönetim';
  if (user.isActive !== true) updates.isActive = true;

  const nextPayload = user.payload && typeof user.payload === 'object' && !Array.isArray(user.payload)
    ? { ...user.payload }
    : {};
  if (nextPayload.owner !== true) {
    nextPayload.owner = true;
    updates.payload = nextPayload;
  }

  if (Object.keys(updates).length > 0) {
    updates.updatedAt = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: updates,
    });
  }

  console.log(JSON.stringify({
    ok: true,
    changed: Object.keys(updates).length > 0,
    email: normalizeEmail(user.email),
    userId: user.id,
    ensured: {
      role: updates.role || user.role,
      department: updates.department || user.department,
      isActive: updates.isActive ?? user.isActive,
      owner: true,
      proximityPermissionsVia: 'admin:*',
    },
  }, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
