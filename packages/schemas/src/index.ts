import { optionalEnvString, serverNameSchema } from "./env.ts";
export {
  historyShareSchema,
  setGroupHistoryShareSchema,
  setHistoryShareSchema,
} from "./schemas/account/historyShare.ts";
export {
  locationSharingChangeInputSchema,
  setLocationSharingSchema,
} from "./schemas/account/locationSharing.ts";
import {
  approveDeviceLinkSchema,
  deviceIconSchema,
  deviceLinkIdSchema,
  deviceNameSchema,
  removeDeviceSchema,
  updateDeviceSchema,
} from "./schemas/account/devices.ts";
import { accountNoticesSyncSchema } from "./schemas/account/accountNotices.ts";
import { changePasswordSchema } from "./schemas/account/changePassword.ts";
import { emailAlertSettingsSchema, timezoneSchema } from "./schemas/account/emailAlerts.ts";
import {
  effectiveNotificationSetting,
  notificationChannelSchema,
  notificationTypeSchema,
  notificationTypes,
  setNotificationSettingSchema,
} from "./schemas/account/notificationSettings.ts";
import { emailCodeSchema } from "./schemas/account/emailCode.ts";
import { accountNameFromProfile, accountNameSchema } from "./schemas/account/fields.ts";
import { signInSchema } from "./schemas/account/signIn.ts";
import { signUpSchema } from "./schemas/account/signUp.ts";
import {
  addHistoryWrapsSchema,
  changeRecoveryPhraseSchema,
  createAccountHistoryKeySchema,
  resetAccountRecoverySchema,
  setupAccountRecoverySchema,
} from "./schemas/auth/accountRecovery.ts";
import {
  devicePlatformSchema,
  groupEpochBundleSchema,
  HISTORY_RECIPIENT_MISMATCH_MESSAGE,
  registerDeviceKeySchema,
  wrappedEpochKeySchema,
} from "./schemas/auth/registerDeviceKey.ts";
import {
  FEEDBACK_MESSAGE_MAX_LENGTH,
  submitFeedbackSchema,
} from "./schemas/feedback/submitFeedback.ts";
import { createGroupSchema, newGroupIdSchema } from "./schemas/group/create.ts";
import { inviteMemberToGroupSchema } from "./schemas/group/inviteMember.ts";
import { sealedPersonalDataSchema } from "./schemas/group/personalData.ts";
import {
  createPlaceSchema,
  deletePlaceSchema,
  listPlacesSchema,
  MAX_PLACES_PER_GROUP,
  placeEmojiSchema,
  PLACE_GEOMETRY_KIND,
  placeNameSchema,
  reEncryptPlacesSchema,
  updatePlaceSchema,
} from "./schemas/group/places.ts";
import {
  getPlaceAlertMutesSchema,
  getPlaceSharingSchema,
  groupHistoryCategorySchema,
  groupHistorySchema,
  alertsCursorSchema,
  placeTransitionSchema,
  recentPlaceTransitionsSchema,
  setPlaceAlertMuteSchema,
  setPlaceSharingSchema,
} from "./schemas/group/placeTransitions.ts";
import { removeGroupMemberSchema } from "./schemas/group/removeMember.ts";
import {
  groupTrackingGetLatestSchema,
  groupTrackingHistoryDaysSchema,
  groupTrackingHistoryRangeSchema,
  groupTrackingPointSchema,
  groupTrackingPollSchema,
  groupTrackingRequestUpdateSchema,
  groupTrackingUploadBatchSchema,
  TRACKING_POINT_KIND,
  TRACKING_POINT_ROLES,
} from "./schemas/group/tracking.ts";
import {
  confirmGroupImageUploadSchema,
  confirmProfileImageUploadSchema,
  encryptedImageKeySchema,
  imageFileNameSchema,
  MAX_IMAGE_KEY_REENCRYPTS,
  reEncryptImageKeysSchema,
  storeImageKeySchema,
} from "./schemas/image/imageKeys.ts";
import { presignImageUploadInputSchema } from "./schemas/image/presignImageUpload.ts";

export {
  announcementMessageSchema,
  announcementSchema,
  appVersionSchema,
  compareAppVersions,
} from "./schemas/announcement/announcement.ts";
export type { Announcement } from "./schemas/announcement/announcement.ts";

export {
  accountNoticesSyncSchema,
  deviceIconSchema,
  deviceNameSchema,
  devicePlatformSchema,
  emailAlertSettingsSchema,
  timezoneSchema,
  effectiveNotificationSetting,
  notificationChannelSchema,
  notificationTypeSchema,
  notificationTypes,
  setNotificationSettingSchema,
  accountNameFromProfile,
  accountNameSchema,
  addHistoryWrapsSchema,
  changePasswordSchema,
  changeRecoveryPhraseSchema,
  confirmGroupImageUploadSchema,
  confirmProfileImageUploadSchema,
  createAccountHistoryKeySchema,
  createGroupSchema,
  createPlaceSchema,
  deletePlaceSchema,
  emailCodeSchema,
  encryptedImageKeySchema,
  getPlaceAlertMutesSchema,
  getPlaceSharingSchema,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  HISTORY_RECIPIENT_MISMATCH_MESSAGE,
  newGroupIdSchema,
  sealedPersonalDataSchema,
  groupEpochBundleSchema,
  groupTrackingGetLatestSchema,
  groupTrackingHistoryDaysSchema,
  groupTrackingHistoryRangeSchema,
  groupTrackingPointSchema,
  groupTrackingPollSchema,
  groupTrackingRequestUpdateSchema,
  groupTrackingUploadBatchSchema,
  groupHistoryCategorySchema,
  groupHistorySchema,
  imageFileNameSchema,
  inviteMemberToGroupSchema,
  listPlacesSchema,
  MAX_IMAGE_KEY_REENCRYPTS,
  MAX_PLACES_PER_GROUP,
  optionalEnvString,
  alertsCursorSchema,
  placeEmojiSchema,
  placeNameSchema,
  placeTransitionSchema,
  reEncryptImageKeysSchema,
  reEncryptPlacesSchema,
  recentPlaceTransitionsSchema,
  serverNameSchema,
  setPlaceAlertMuteSchema,
  setPlaceSharingSchema,
  registerDeviceKeySchema,
  removeGroupMemberSchema,
  presignImageUploadInputSchema,
  resetAccountRecoverySchema,
  setupAccountRecoverySchema,
  signInSchema,
  signUpSchema,
  storeImageKeySchema,
  submitFeedbackSchema,
  TRACKING_POINT_KIND,
  TRACKING_POINT_ROLES,
  PLACE_GEOMETRY_KIND,
  removeDeviceSchema,
  updateDeviceSchema,
  updatePlaceSchema,
  wrappedEpochKeySchema,
  approveDeviceLinkSchema,
  deviceLinkIdSchema,
};
