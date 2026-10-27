import { redirect } from "react-router";

export function loader() {
  return redirect("/auth/sign-in");
}
