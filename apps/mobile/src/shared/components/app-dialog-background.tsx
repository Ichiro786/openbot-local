import { type PropsWithChildren, useSyncExternalStore } from "react";
import { View } from "react-native";
import { appDialogs } from "@/shared/lib/app-dialog-state";

/** Android's accessibility service must not reach controls behind a confirmation. */
export function AppDialogBackground({ children }: PropsWithChildren) {
  const request = useSyncExternalStore(appDialogs.subscribe, appDialogs.getSnapshot);
  return (
    <View
      className="flex-1"
      pointerEvents={request ? "none" : "auto"}
      accessibilityElementsHidden={request !== null}
      importantForAccessibility={request ? "no-hide-descendants" : "auto"}
    >
      {children}
    </View>
  );
}
