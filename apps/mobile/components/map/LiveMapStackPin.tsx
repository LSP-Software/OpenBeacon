import { useEffect, useEffectEvent, useState } from "react";
import { View } from "react-native";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import { DecryptedAvatarImage } from "../image/DecryptedAvatarImage.tsx";
import { Avatar, AvatarFallback } from "../ui/Avatar.tsx";
import { Text } from "../ui/Text.tsx";
import { LiveMapMarkerPin } from "./LiveMapMarkerPin.tsx";

export const LiveMapStackPin = ({
  members,
  onBitmapContentChange,
}: {
  members: readonly LiveMapMarker[];
  onBitmapContentChange?: (() => void) | undefined;
}) => {
  const [imageStatusChanges, setImageStatusChanges] = useState(0);
  const refreshBitmap = useEffectEvent(() => onBitmapContentChange?.());

  // biome-ignore lint/correctness/useExhaustiveDependencies: Android draws map pins into a bitmap that needs an explicit refresh once an avatar has loaded or fallen back
  useEffect(() => {
    if (imageStatusChanges > 0) refreshBitmap();
  }, [imageStatusChanges]);

  const [lead, ...others] = members;
  if (!lead) return null;
  const ringColors = [
    ...new Set(members.flatMap((member) => member.ringColors ?? [member.ringColor])),
  ];

  return (
    <View collapsable={false} style={{ width: 48, height: 48 }}>
      {others.slice(0, 2).map((member, index) => (
        <View
          key={member.deviceId}
          collapsable={false}
          style={{
            position: "absolute",
            top: 9,
            left: index === 0 ? 24 : -6,
            width: 30,
            height: 30,
            borderRadius: 15,
            borderWidth: 2,
            borderColor: "#FFFFFF",
            backgroundColor: "#FFFFFF",
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Avatar alt={member.name} className="size-7">
            <DecryptedAvatarImage
              url={member.image}
              {...(onBitmapContentChange ? { fadeDuration: 0 } : {})}
              onLoadingStatusChange={() => setImageStatusChanges((changes) => changes + 1)}
            />
            <AvatarFallback>
              <Text className="text-[10px] font-bold">{member.initials}</Text>
            </AvatarFallback>
          </Avatar>
        </View>
      ))}
      <LiveMapMarkerPin
        hasUnreadableUpdate={lead.unreadableGroup !== undefined}
        image={lead.image}
        initials={lead.initials}
        name={lead.name}
        onBitmapContentChange={onBitmapContentChange}
        ringColor={lead.ringColor}
        ringColors={ringColors.length > 1 ? ringColors : undefined}
        timestamp={lead.timestamp}
      />
      <View
        className="absolute items-center justify-center rounded-full border-2 border-white bg-primary"
        style={{ top: -4, right: -6, minWidth: 22, height: 22, paddingHorizontal: 4 }}
      >
        <Text className="text-[11px] font-bold leading-[14px] text-primary-foreground">
          {members.length}
        </Text>
      </View>
    </View>
  );
};
