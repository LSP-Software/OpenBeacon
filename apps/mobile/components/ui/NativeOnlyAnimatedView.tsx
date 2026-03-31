import Animated from "react-native-reanimated";

const NativeOnlyAnimatedView = (
  props: React.ComponentProps<typeof Animated.View> & React.RefAttributes<Animated.View>,
) => <Animated.View {...props} />;

export { NativeOnlyAnimatedView };
