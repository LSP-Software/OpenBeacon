-- CreateTable
CREATE TABLE "user_device" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT,
    "public_key" TEXT NOT NULL,
    "public_key_algorithm" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "user_device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_epoch" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "epoch_number" INTEGER NOT NULL,
    "created_by_device_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_epoch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_epoch_recipient_key" (
    "id" TEXT NOT NULL,
    "group_epoch_id" TEXT NOT NULL,
    "recipient_device_id" TEXT NOT NULL,
    "wrapped_key" TEXT NOT NULL,
    "ephemeral_public_key" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_epoch_recipient_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_device_userId_idx" ON "user_device"("user_id");

-- CreateIndex
CREATE INDEX "group_epoch_groupId_createdAt_idx" ON "group_epoch"("group_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "group_epoch_groupId_epochNumber_unique" ON "group_epoch"("group_id", "epoch_number");

-- CreateIndex
CREATE UNIQUE INDEX "group_epoch_recipient_key_groupEpochId_recipientDeviceId_unique" ON "group_epoch_recipient_key"("group_epoch_id", "recipient_device_id");

-- AddForeignKey
ALTER TABLE "user_device" ADD CONSTRAINT "user_device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_epoch" ADD CONSTRAINT "group_epoch_group_id_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_epoch" ADD CONSTRAINT "group_epoch_created_by_device_id_user_device_id_fk" FOREIGN KEY ("created_by_device_id") REFERENCES "user_device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_epoch_recipient_key" ADD CONSTRAINT "group_epoch_recipient_key_group_epoch_id_group_epoch_id_fk" FOREIGN KEY ("group_epoch_id") REFERENCES "group_epoch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_epoch_recipient_key" ADD CONSTRAINT "group_epoch_recipient_key_recipient_device_id_user_device_id_fk" FOREIGN KEY ("recipient_device_id") REFERENCES "user_device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
