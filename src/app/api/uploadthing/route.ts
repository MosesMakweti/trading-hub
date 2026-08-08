import { createRouteHandler } from "uploadthing/next";

import { ourFileRouter } from "@/server/uploadthing";

// UploadThing reads UPLOADTHING_TOKEN from the environment. When it is unset the
// upload UI is hidden (ImageAttachments resolves this via loadMediaAction), so this
// handler is only hit once hosting is actually configured.
export const { GET, POST } = createRouteHandler({ router: ourFileRouter });
