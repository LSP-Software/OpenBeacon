import { Link, router } from "expo-router";
import { useState } from "react";
import { Alert, Button, TextInput, View } from "react-native";
import { authClient } from "../lib/auth-client";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async () => {
    const response = await authClient.signIn.email({
      email,
      password,
    });

    if (response.error) {
      Alert.alert(response.error.message ?? "An error occured");
      return;
    }

    router.push("/");
  };

  return (
    <View>
      <TextInput placeholder="Email" value={email} onChangeText={setEmail} />
      <TextInput
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry={true}
      />
      <Button title="Login" onPress={handleLogin} />
      <Link href="/signUp">Don't have an account? Sign up</Link>
    </View>
  );
}
