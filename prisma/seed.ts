import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env");
  const passwordHash = await bcrypt.hash(password, 12);
  await db.user.upsert({
    where: { email: email.toLowerCase() },
    create: { email: email.toLowerCase(), passwordHash, role: "ADMIN" },
    update: { passwordHash, role: "ADMIN" },
  });
  console.log(`Admin ready: ${email}`);
}

main().finally(() => db.$disconnect());
