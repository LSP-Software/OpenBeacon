import { useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { queryClient } from "../lib/api";

export const RefreshablePage = ({ children }: { children: React.ReactNode }) => {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.refetchQueries();
    setRefreshing(false);
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {children}
    </ScrollView>
  );
};
