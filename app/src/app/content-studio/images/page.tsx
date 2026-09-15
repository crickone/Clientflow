import { redirect } from "next/navigation";

/**
 * A second list of the same designs used to live here, reachable only from the
 * designer's back link and the post-delete redirect -- never from the nav. It
 * called the same listCarousels() the Content Studio hub calls, and painted a
 * gradient where the hub paints the slide's real render, so the worse list was
 * the one an operator landed on after deleting a design.
 *
 * The route stays so a bookmark still works; the page is the hub.
 */
export default function ImagesPage() {
  redirect("/content-studio");
}
