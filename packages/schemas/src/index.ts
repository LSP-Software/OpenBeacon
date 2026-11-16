import { optionalEnvString, serverNameSchema } from "./env.ts";
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
import { changePasswordSchema } from "./schemas/account/changePassword.ts";
import { emailAlertSettingsSchema, timezoneSchema } from "./schemas/account/emailAlerts.ts";
import { emailCodeSchema } from "./schemas/account/emailCode.ts";
import { accountNameSchema } from "./schemas/account/fields.ts";
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
  placeAlertsCursorSchema,
  placeTransitionSchema,
  recentPlaceTransitionsSchema,
  setPlaceAlertMuteSchema,
  setPlaceSharingSchema,
} from "./schemas/group/placeTransitions.ts";
import { removeGroupMemberSchema } from "./schemas/group/removeMember.ts";
import {
  groupTrackingGetLatestSchema,
  groupTrackingPointSchema,
  groupTrackingPollSchema,
  groupTrackingUploadBatchSchema,
  TRACKING_POINT_KIND,
} from "./schemas/group/tracking.ts";
import { requestImageUploadInputSchema } from "./schemas/image/requestImageUpload.ts";

export {
  deviceIconSchema,
  deviceNameSchema,
  devicePlatformSchema,
  emailAlertSettingsSchema,
  timezoneSchema,
  accountNameSchema,
  addHistoryWrapsSchema,
  changePasswordSchema,
  changeRecoveryPhraseSchema,
  createAccountHistoryKeySchema,
  createGroupSchema,
  createPlaceSchema,
  deletePlaceSchema,
  emailCodeSchema,
  getPlaceAlertMutesSchema,
  getPlaceSharingSchema,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  HISTORY_RECIPIENT_MISMATCH_MESSAGE,
  newGroupIdSchema,
  groupEpochBundleSchema,
  groupTrackingGetLatestSchema,
  groupTrackingPointSchema,
  groupTrackingPollSchema,
  groupTrackingUploadBatchSchema,
  groupHistoryCategorySchema,
  groupHistorySchema,
  inviteMemberToGroupSchema,
  listPlacesSchema,
  MAX_PLACES_PER_GROUP,
  optionalEnvString,
  placeAlertsCursorSchema,
  placeEmojiSchema,
  placeNameSchema,
  placeTransitionSchema,
  reEncryptPlacesSchema,
  recentPlaceTransitionsSchema,
  serverNameSchema,
  setPlaceAlertMuteSchema,
  setPlaceSharingSchema,
  registerDeviceKeySchema,
  removeGroupMemberSchema,
  requestImageUploadInputSchema,
  resetAccountRecoverySchema,
  setupAccountRecoverySchema,
  signInSchema,
  signUpSchema,
  submitFeedbackSchema,
  TRACKING_POINT_KIND,
  PLACE_GEOMETRY_KIND,
  removeDeviceSchema,
  updateDeviceSchema,
  updatePlaceSchema,
  wrappedEpochKeySchema,
  approveDeviceLinkSchema,
  deviceLinkIdSchema,
};
