import { useEffect, useState } from "react";
import { AccessibilityInfo, useWindowDimensions } from "react-native";

/** Keep dense action lists roomy when reading or focusing needs more space. */
export function useActionDensity() {
  const [screenReader, setScreenReader] = useState(true);
  const { fontScale } = useWindowDimensions();
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (active) setScreenReader(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", setScreenReader);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return !screenReader && fontScale <= 1.2;
}
