import { Redirect, router } from "expo-router";
import { Button, StyleSheet, Text, View } from "react-native";
import { authClient } from "../lib/auth-client";

export default function HomeScreen() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>OpenBeacon</Text>
      {session && <Text>Welcome, {session.user.name}</Text>}
      {!session && <Button title="Sign In" onPress={() => router.push("/signIn")} />}
      {!session && <Button title="Sign Up" onPress={() => router.push("/signUp")} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
});
