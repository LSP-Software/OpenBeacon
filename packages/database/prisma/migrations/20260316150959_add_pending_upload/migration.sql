/*
  Warnings:

  - You are about to drop the `pending_group_image_upload` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `pending_profile_image_upload` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "pending_group_image_upload" DROP CONSTRAINT "pending_group_image_upload_group_id_Group_id_fk";

-- DropForeignKey
ALTER TABLE "pending_profile_image_upload" DROP CONSTRAINT "pending_profile_image_upload_user_id_user_id_fk";

-- DropTable
DROP TABLE "pending_group_image_upload";

-- DropTable
DROP TABLE "pending_profile_image_upload";

-- CreateTable
CREATE TABLE "pending_upload" (
    "user_id" TEXT NOT NULL,
    "upload_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "group_id" TEXT,

    CONSTRAINT "pending_upload_pkey" PRIMARY KEY ("user_id","upload_type")
);

-- CreateIndex
CREATE INDEX "pending_upload_group_id_idx" ON "pending_upload"("group_id");

-- AddForeignKey
ALTER TABLE "pending_upload" ADD CONSTRAINT "pending_upload_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_upload" ADD CONSTRAINT "pending_upload_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
