import { generateReactHelpers } from "@uploadthing/react";

import type { OurFileRouter } from "@/server/uploadthing";

// `import type` above erases at build time, so no server code (Prisma, auth) is
// pulled into the client bundle — only the router's types cross the boundary.
export const { useUploadThing } = generateReactHelpers<OurFileRouter>();
