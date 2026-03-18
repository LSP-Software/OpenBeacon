import { RefreshControl, ScrollView } from "react-native";
import { queryClient } from "../lib/api";

export const RefreshablePage = ({ children }: { children: React.ReactNode }) => {
  return (
    <ScrollView
      className="flex-1 bg-background"
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => {
            queryClient.invalidateQueries();
          }}
        />
      }
    >
      {children}
    </ScrollView>
  );
};
