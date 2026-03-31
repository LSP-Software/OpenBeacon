import Animated from "react-native-reanimated";

const AnimatedView = (
  props: React.ComponentProps<typeof Animated.View> & React.RefAttributes<Animated.View>,
) => <Animated.View {...props} />;

export { AnimatedView };
