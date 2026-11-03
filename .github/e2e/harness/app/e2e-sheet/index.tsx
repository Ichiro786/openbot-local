// E2E HARNESS: same header shape as the Add agent screen (AndroidHeaderButton X in a SheetScrollView).
import { router } from "expo-router";
import X from "lucide-react-native/icons/x";
import { Text } from "react-native";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";

export default function E2ESheet() {
  return (
    <SheetScrollView clearHeader className="bg-sheet" contentContainerClassName="gap-5 px-5 pt-5">
      <AndroidHeaderButton placement="left" icon={X} accessibilityLabel="Close" onPress={() => router.back()} />
      <Text style={{ color: "#888", fontSize: 18 }}>E2E SHEET OPEN</Text>
    </SheetScrollView>
  );
}
