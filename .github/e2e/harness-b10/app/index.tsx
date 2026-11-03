// E2E HARNESS, build 10 variant (review branch build10-review-ci only, never shipped). Applied when the
// target has src/shared/motion/zoomPush.ts. Signed-out stand-in for home: the content sits in a
// BlurTargetView registered like home's, a native-stack headerRight ••• MenuView (as build 9), a row
// with the real long-press MenuView with a sub-menu (like an agent row), and a row that zoom-opens
// /e2e-chat through the real ZoomOpenOverlay (like chat-link-pressable).
import { BlurTargetView } from "expo-blur";
import { router, Stack } from "expo-router";
import { useContext, useEffect, useRef, useState } from "react";
import { Pressable, Text, View, type ViewInstance } from "react-native";
import { useMotionPreferences } from "@/features/settings/model/motion";
import { MenuView } from "@/shared/components/menu-view";
import { SplashContentReadyContext } from "@/shared/lib/use-splash-gate";
import { useFrostTarget } from "@/shared/motion/frostTarget";
import { zoomOpen } from "@/shared/motion/ZoomOpenOverlay";

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
// Like the agent row menu: flat rows plus a "Move to folder" sub-menu and a "More" sub-menu.
const ROW_ACTIONS = [
  { id: "mark-unread", title: "Mark unread" },
  { id: "pin", title: "Pin" },
  { id: "hide", title: "Hide" },
  {
    id: "move",
    title: "Move to folder",
    subactions: [
      { id: "folder-a", title: "Folder Alpha" },
      { id: "folder-b", title: "Folder Beta" },
    ],
  },
  { id: "info", title: "Info" },
  { id: "more", title: "More", subactions: [{ id: "rename", title: "Rename" }, { id: "delete", title: "Delete", attributes: { destructive: true } }] },
];

export default function E2EHarness() {
  const colorOS = useMotionPreferences((s) => s.colorOSMotion);
  const reportContentReady = useContext(SplashContentReadyContext);
  useEffect(() => {
    reportContentReady();
  }, [reportContentReady]);
  const frost = useRef<ViewInstance>(null);
  useFrostTarget(frost, true);
  const [last, setLast] = useState("none");
  const zoomRow = useRef<View>(null);
  const openChat = () => {
    const go = () => router.push("/e2e-chat");
    const view = zoomRow.current;
    // As chat-link-pressable: the zoom only with ColorOS motion on.
    if (!view || !useMotionPreferences.getState().colorOSMotion) return go();
    view.measureInWindow((x, y, width, height) => {
      if (!width || !height || !zoomOpen({ x, y, width, height }, go, 0)) go();
    });
  };
  return (
    <BlurTargetView ref={frost} style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: "#1d2b3a", paddingTop: 110 }}>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTransparent: true,
            title: "E2E",
            headerRight: () => (
              <MenuView
                actions={ACTIONS}
                onPressAction={(event) => {
                  setLast(event.nativeEvent.event);
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
        <Text style={{ color: "#fff", fontSize: 16, marginHorizontal: 24 }}>{`E2E READY frost colorOS=${colorOS ? "ON" : "OFF"}`}</Text>
        <Text style={{ color: "#fff", fontSize: 16, marginHorizontal: 24, marginTop: 4 }}>{`LAST=${last}`}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Toggle ColorOS"
          onPress={() => useMotionPreferences.setState({ colorOSMotion: !useMotionPreferences.getState().colorOSMotion })}
          style={{ marginHorizontal: 24, marginTop: 12, padding: 14, backgroundColor: "#3b5b7a", borderRadius: 12 }}
        >
          <Text style={{ color: "#fff" }}>Toggle ColorOS</Text>
        </Pressable>
        <MenuView
          actions={ROW_ACTIONS}
          shouldOpenOnLongPress
          onPressAction={(event) => setLast(event.nativeEvent.event)}
          style={{ marginHorizontal: 12, marginTop: 16 }}
        >
          <View accessible accessibilityLabel="E2E Bot row" style={{ height: 64, borderRadius: 12, backgroundColor: "#2c3e50", justifyContent: "center", paddingHorizontal: 16 }}>
            <Text style={{ color: "#fff", fontSize: 17 }}>E2E Bot row (hold me)</Text>
          </View>
        </MenuView>
        <Pressable ref={zoomRow} accessibilityRole="button" accessibilityLabel="E2E Zoom chat" onPress={openChat} style={{ marginHorizontal: 12, marginTop: 12, height: 64, borderRadius: 12, backgroundColor: "#6c3483", justifyContent: "center", paddingHorizontal: 16 }}>
          <Text style={{ color: "#fff", fontSize: 17 }}>E2E Zoom chat (tap me)</Text>
        </Pressable>
        {Array.from({ length: 10 }, (_, i) => (
          <View key={i} style={{ height: 40, marginHorizontal: 24, marginTop: 8, borderRadius: 8, backgroundColor: i % 2 ? "#e0525a" : "#4fb06d" }} />
        ))}
      </View>
    </BlurTargetView>
  );
}
