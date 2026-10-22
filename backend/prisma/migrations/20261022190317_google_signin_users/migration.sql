-- AlterTable
ALTER TABLE "users" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "last_login_at" TIMESTAMP(3),
ALTER COLUMN "password_hash" DROP NOT NULL;
