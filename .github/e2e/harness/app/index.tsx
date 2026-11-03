// E2E HARNESS (review branch build9-review-ci only, never shipped). Replaces the signed-out index route
// so an emulator without an OpenBot account can drive the real MenuView / GlassMenu code from a
// native-stack headerRight, exactly as home does, and push a formSheet like Add agent.
import { router, Stack } from "expo-router";
import { useContext, useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { useMotionPreferences } from "@/features/settings/model/motion";
import { MenuView } from "@/shared/components/menu-view";
import { SplashContentReadyContext } from "@/shared/lib/use-splash-gate";

const ACTIONS = [
  {
    id: "add",
    title: "",
    displayInline: true,
    subactions: [
      { id: "add-agent", title: "Add agent" },
      { id: "add-section", title: "New section" },
    ],
  },
  { id: "chats", title: "", displayInline: true, subactions: [{ id: "hidden-chats", title: "Hidden chats" }] },
];

export default function E2EHarness() {
  const colorOS = useMotionPreferences((s) => s.colorOSMotion);
  // The sign-in screen this replaces reports readiness, which lifts the launch loader over the app.
  const reportContentReady = useContext(SplashContentReadyContext);
  useEffect(() => {
    reportContentReady();
  }, [reportContentReady]);
  return (
    <View style={{ flex: 1, backgroundColor: "#1d2b3a", paddingTop: 120 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          title: "E2E",
          headerRight: () => (
            <MenuView
              actions={ACTIONS}
              onPressAction={(event) => {
                if (event.nativeEvent.event === "add-agent") router.push("/e2e-sheet");
              }}
              style={{ height: 48, width: 48 }}
            >
              <View
                accessibilityLabel="Chat options"
                accessibilityRole="button"
                accessible
                style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: "#fff", fontSize: 24 }}>⋮</Text>
              </View>
            </MenuView>
          ),
        }}
      />
      <Text style={{ color: "#fff", fontSize: 18, margin: 24 }}>{`E2E READY colorOS=${colorOS ? "ON" : "OFF"}`}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Toggle ColorOS"
        onPress={() => useMotionPreferences.setState({ colorOSMotion: !useMotionPreferences.getState().colorOSMotion })}
        style={{ margin: 24, padding: 16, backgroundColor: "#3b5b7a", borderRadius: 12 }}
      >
        <Text style={{ color: "#fff" }}>Toggle ColorOS</Text>
      </Pressable>
      {Array.from({ length: 12 }, (_, i) => (
        <View key={i} style={{ height: 40, marginHorizontal: 24, marginBottom: 8, borderRadius: 8, backgroundColor: i % 2 ? "#e0525a" : "#4fb06d" }} />
      ))}
    </View>
  );
}
