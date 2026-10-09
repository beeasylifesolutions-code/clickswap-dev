-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "ordersCheckedAt" TIMESTAMP(3),
ADD COLUMN     "ordersLast30" INTEGER NOT NULL DEFAULT 0;
