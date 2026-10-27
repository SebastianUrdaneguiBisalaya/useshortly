import {
  index,
  layout,
  type RouteConfig,
  route,
} from "@react-router/dev/routes";

export default [
  index("routes/index.tsx"),
  layout("../features/auth/layout.tsx", [
    route("auth/sign-in", "../features/auth/sign-in.tsx"),
    route("auth/sign-up", "../features/auth/sign-up.tsx"),
    route("auth/forgot-password", "../features/auth/forgot-password.tsx"),
    route("auth/reset-password", "../features/auth/reset-password.tsx"),
  ]),
] satisfies RouteConfig;
