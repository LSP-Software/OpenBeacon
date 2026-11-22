import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { type Edge, SafeAreaView } from "react-native-safe-area-context";

export const RefreshablePage = ({
  children,
  edges = ["top"],
}: {
  children: React.ReactNode;
  edges?: readonly Edge[];
}) => {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.refetchQueries({ type: "active" });
    setRefreshing(false);
  };

  return (
    <SafeAreaView edges={edges} className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        nestedScrollEnabled
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
};
