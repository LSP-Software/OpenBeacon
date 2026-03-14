ALTER TABLE "pending_profile_image_upload"
  ADD CONSTRAINT "pending_profile_image_upload_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
