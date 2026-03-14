-- CreateTable
CREATE TABLE "pending_profile_image_upload" (
    "user_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_profile_image_upload_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "pending_profile_image_upload" ADD CONSTRAINT "pending_profile_image_upload_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
