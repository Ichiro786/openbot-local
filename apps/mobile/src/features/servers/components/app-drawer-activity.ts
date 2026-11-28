import { createContext, useContext } from "react";
import { makeMutable, type SharedValue } from "react-native-reanimated";

export const AppDrawerMovingContext = createContext(false);

export const AppDrawerShownContext = createContext(false);

export const AppDrawerShownOnUIContext = createContext<SharedValue<boolean>>(makeMutable(false));

export function useAppDrawerMoving(): boolean {
  return useContext(AppDrawerMovingContext);
}

export function useAppDrawerShown(): boolean {
  return useContext(AppDrawerShownContext);
}

export function useAppDrawerShownOnUI(): SharedValue<boolean> {
  return useContext(AppDrawerShownOnUIContext);
}
