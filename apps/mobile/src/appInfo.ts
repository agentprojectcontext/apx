import Constants from "expo-constants";

/** This app as the core sees it: one name and the version from app.json, for every client it opens. */
export const APP_CLIENT = { name: "apx-mobile", version: Constants.expoConfig?.version ?? "0.0.0" };
