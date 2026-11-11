import { optionalEnvString, serverNameSchema } from "./env.ts";
import {
  deviceIconSchema,
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
  emailCodeSchema,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  HISTORY_RECIPIENT_MISMATCH_MESSAGE,
  newGroupIdSchema,
  groupEpochBundleSchema,
  groupTrackingGetLatestSchema,
  groupTrackingPointSchema,
  groupTrackingPollSchema,
  groupTrackingUploadBatchSchema,
  inviteMemberToGroupSchema,
  optionalEnvString,
  serverNameSchema,
  registerDeviceKeySchema,
  removeGroupMemberSchema,
  requestImageUploadInputSchema,
  resetAccountRecoverySchema,
  setupAccountRecoverySchema,
  signInSchema,
  signUpSchema,
  submitFeedbackSchema,
  TRACKING_POINT_KIND,
  removeDeviceSchema,
  updateDeviceSchema,
  wrappedEpochKeySchema,
};
