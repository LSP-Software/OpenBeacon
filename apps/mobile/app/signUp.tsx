import { Link, router } from "expo-router";
import { useState } from "react";
import { Alert, Button, TextInput, View } from "react-native";
import { authClient } from "../lib/auth-client";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async () => {
    const response = await authClient.signUp.email({
      email,
      password,
      name,
    });

    if (response.error) {
      Alert.alert(response.error.message ?? "An error occured");
      return;
    }

    router.push("/");
  };

  return (
    <View>
      <TextInput placeholder="Name" value={name} onChangeText={setName} />
      <TextInput placeholder="Email" value={email} onChangeText={setEmail} />
      <TextInput
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry={true}
      />
      <Button title="Sign Up" onPress={handleLogin} />
      <Link href="/signIn">Already have an account? Sign in</Link>
    </View>
  );
}
