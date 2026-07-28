-- CreateEnum
CREATE TYPE "DeficitMode" AS ENUM ('PERCENT', 'KCAL');

-- AlterTable
ALTER TABLE "profile" ADD COLUMN     "deficit_mode" "DeficitMode" NOT NULL DEFAULT 'PERCENT',
ADD COLUMN     "deficit_value" DOUBLE PRECISION NOT NULL DEFAULT 20,
ADD COLUMN     "fat_per_kg" DOUBLE PRECISION,
ADD COLUMN     "protein_per_kg" DOUBLE PRECISION;
