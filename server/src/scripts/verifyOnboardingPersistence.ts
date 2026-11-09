/**
 * Restart/reconnect persistence check for a known approved onboarding run.
 * Usage: npx tsx src/scripts/verifyOnboardingPersistence.ts <publicId> <shopId> <ownerEmail>
 */
import { connectDb, disconnectDb, getDbMode } from '../config/db.js';
import { RepairShop, ShopApplication, ShopMembership, User } from '../models/index.js';

async function main() {
  const [publicId, shopId, email] = process.argv.slice(2);
  if (!publicId || !shopId || !email) {
    throw new Error('Usage: verifyOnboardingPersistence.ts <publicId> <shopId> <ownerEmail>');
  }

  await connectDb();
  const app = await ShopApplication.findOne({ publicId }).lean();
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash').lean();
  const shop = await RepairShop.findById(shopId).lean();
  const memberships = await ShopMembership.countDocuments({
    shop: shopId,
    role: 'shop_admin',
    isActive: true
  });
  const rejectEmail = email.replace('e2e.owner.', 'e2e.reject.');
  const rejected = await ShopApplication.findOne({
    ownerEmail: rejectEmail.toLowerCase(),
    status: 'rejected'
  }).lean();

  const ok = !!(
    app?.status === 'approved' &&
    String(app.provisionedShop) === shopId &&
    user?.accountStatus === 'active' &&
    user.passwordHash &&
    !user.passwordHash.includes('SecurePass') &&
    shop &&
    memberships === 1
  );

  console.log(
    JSON.stringify(
      {
        ok,
        dbMode: getDbMode(),
        applicationStatus: app?.status,
        provisionedShop: String(app?.provisionedShop || ''),
        userAccountStatus: user?.accountStatus,
        passwordLooksHashed: !!(user?.passwordHash && !user.passwordHash.includes('SecurePass')),
        shopName: shop?.name,
        shopCode: (shop as { code?: string } | null)?.code,
        activeAdminMemberships: memberships,
        rejectedAppStatus: rejected?.status || null,
        rejectionReason: rejected?.rejectionReason || null
      },
      null,
      2
    )
  );

  await disconnectDb();
  if (!ok) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
