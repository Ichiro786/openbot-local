import { AlertDialog, Column, Host, Text as ComposeText, TextButton } from "@expo/ui/jetpack-compose";
import { BlurView } from "expo-blur";
import { Dialog } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Keyboard, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { FadeOut } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useCSSVariable, useUniwind } from "uniwind";
import { Button } from "@/shared/components/button";
import { ANDROID_BLUR } from "@/shared/components/glass-capsule";
import { useBlurBudget } from "@/shared/glass/blurBudget";
import { appDialogs, type AppDialogRequest } from "@/shared/lib/app-dialog-state";
import { APP_FONT } from "@/shared/lib/app-font";
import { useText } from "@/shared/lib/text";
import { useReducedTransparency } from "@/shared/lib/use-reduced-transparency";
import { currentFrostTarget } from "@/shared/motion/frostTarget";
import { dismissActiveGlassMenu } from "@/shared/motion/GlassMenu";
import { addChatBackListener } from "@/shared/motion/predictiveBack";
import { useBlurLive } from "@/shared/motion/useBlurLive";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";

/** A single application host; permissions and OS-owned prompts do not use this queue. */
export function AppDialogHost() {
  const request = useSyncExternalStore(appDialogs.subscribe, appDialogs.getSnapshot);
  useEffect(() => appDialogs.mount(), []);
  return request ? <AppDialog key={request.key} request={request} /> : null;
}

function AppDialog({ request }: { request: AppDialogRequest }) {
  const { t } = useText();
  const { enabled, reduceMotion } = useColorOSMotion();
  const dark = useUniwind().theme === "dark";
  const danger = String(useCSSVariable("--openbot-danger-text"));
  const foreground = String(useThemeColor("foreground"));
  const muted = String(useThemeColor("muted"));
  const surface = String(useCSSVariable("--openbot-bg-sheet"));
  const frostFill = String(useCSSVariable("--openbot-bg-chrome-blur"));
  const reducedTransparency = useReducedTransparency();
  const { height } = useWindowDimensions();
  const [target] = useState(currentFrostTarget);
  const [closing, setClosing] = useState(false);
  const choice = useRef<number | null>(null);
  const closingRef = useRef(false);
  // Keep one presentation for a pending decision even if preferences change behind it.
  const [colorOS] = useState(enabled);
  const frosted = colorOS && ANDROID_BLUR && !reducedTransparency && Boolean(target?.current);
  const live = useBlurLive(frosted);
  useBlurBudget(live, "app-dialog");
  const cancelable = request.options?.cancelable === true;

  useEffect(() => {
    Keyboard.dismiss();
    dismissActiveGlassMenu();
    appDialogs.setFrosted(request.key, frosted);
    return () => appDialogs.setFrosted(request.key, false);
  }, [request.key, frosted]);

  const finish = useCallback(() => {
    appDialogs.settle(request.key, choice.current);
  }, [request.key]);

  const choose = useCallback(
    (index: number | null) => {
      if (closingRef.current || (index === null && !cancelable)) return;
      closingRef.current = true;
      choice.current = index;
      setClosing(true);
    },
    [cancelable],
  );

  // The animation callback normally finishes the glass dialog. The bounded fallback also
  // handles disabled/interrupted animations; the controller accepts each decision once.
  useEffect(() => {
    if (!closing) return;
    if (!colorOS || reduceMotion) {
      let second: number | undefined;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(finish);
      });
      return () => {
        cancelAnimationFrame(first);
        if (second !== undefined) cancelAnimationFrame(second);
      };
    }
    const timer = setTimeout(finish, 400);
    return () => clearTimeout(timer);
  }, [closing, colorOS, reduceMotion, finish]);

  useEffect(() => {
    if (!colorOS) return;
    const listener = addChatBackListener(() => {
      choose(null);
      return true;
    });
    return () => listener.remove();
  }, [colorOS, choose]);

  if (!colorOS) {
    if (closing) return null;
    const buttons = request.buttons.map((button, index) => (
      <TextButton
        key={index}
        onClick={() => choose(index)}
        colors={button.style === "destructive" ? { contentColor: danger } : undefined}
      >
        <ComposeText style={{ fontFamily: APP_FONT }}>{button.text ?? t("common.close")}</ComposeText>
      </TextButton>
    ));
    return (
      <Host matchContents colorScheme={dark ? "dark" : "light"}>
        <AlertDialog
          colors={{ containerColor: surface, titleContentColor: foreground, textContentColor: muted }}
          properties={{ dismissOnBackPress: cancelable, dismissOnClickOutside: cancelable }}
          onDismissRequest={() => choose(null)}
        >
          {request.title ? (
            <AlertDialog.Title>
              <ComposeText style={{ fontFamily: APP_FONT }}>{request.title}</ComposeText>
            </AlertDialog.Title>
          ) : null}
          {request.message ? (
            <AlertDialog.Text>
              <ComposeText style={{ fontFamily: APP_FONT }}>{request.message}</ComposeText>
            </AlertDialog.Text>
          ) : null}
          <AlertDialog.ConfirmButton>
            <Column horizontalAlignment="end">{buttons}</Column>
          </AlertDialog.ConfirmButton>
        </AlertDialog>
      </Host>
    );
  }

  return (
    <Dialog
      isOpen={!closing}
      onOpenChange={(open) => {
        if (!open) choose(null);
      }}
      animation={reduceMotion ? "disable-all" : undefined}
    >
      <Dialog.Portal>
        <Dialog.Overlay variant="default" isCloseOnPress={cancelable} />
        <Dialog.Content
          isSwipeable={false}
          className="w-full max-w-sm gap-5"
          style={{ maxHeight: height * 0.85 }}
          animation={{
            exiting: FadeOut.duration(120).withCallback(() => {
              scheduleOnRN(finish);
            }),
          }}
          background={
            <Dialog.ContentBackground>
              {target?.current && frosted ? (
                <BlurView
                  blurTarget={target}
                  blurMethod={live ? "dimezisBlurViewSdk31Plus" : "none"}
                  blurRegion
                  intensity={32}
                  blurReductionFactor={4}
                  tint={dark ? "dark" : "light"}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              <View style={[StyleSheet.absoluteFill, { backgroundColor: live ? frostFill : surface }]} />
            </Dialog.ContentBackground>
          }
        >
          <ScrollView style={{ flexShrink: 1 }} alwaysBounceVertical={false}>
            <View className="gap-3">
              {request.title ? <Dialog.Title>{request.title}</Dialog.Title> : null}
              {request.message ? <Dialog.Description>{request.message}</Dialog.Description> : null}
            </View>
          </ScrollView>
          <View className="gap-2">
            {request.buttons.map((button, index) => (
              <Button key={index} variant="ghost" isDisabled={closing} onPress={() => choose(index)}>
                <Button.Label className={button.style === "destructive" ? "text-danger-text" : undefined}>
                  {button.text ?? t("common.close")}
                </Button.Label>
              </Button>
            ))}
          </View>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
