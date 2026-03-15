-- AlterTable
ALTER TABLE "Group" ADD COLUMN "image" TEXT;

-- CreateTable
CREATE TABLE "pending_group_image_upload" (
    "group_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_group_image_upload_pkey" PRIMARY KEY ("group_id")
);

-- AddForeignKey
ALTER TABLE "pending_group_image_upload"
  ADD CONSTRAINT "pending_group_image_upload_group_id_Group_id_fk"
  FOREIGN KEY ("group_id") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
