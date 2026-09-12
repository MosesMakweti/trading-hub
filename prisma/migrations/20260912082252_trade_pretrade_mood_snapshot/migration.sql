-- CreateEnum
CREATE TYPE "PreTradeMoodTag" AS ENUM ('CALM', 'FOCUSED', 'CONFIDENT', 'PATIENT', 'HESITANT', 'FEARFUL', 'IMPATIENT', 'EXCITED', 'FOMO', 'FRUSTRATED', 'REVENGE_MINDED');

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "preTradeMoodIntensity" INTEGER,
ADD COLUMN     "preTradeMoodNote" TEXT,
ADD COLUMN     "preTradeMoodTags" "PreTradeMoodTag"[] DEFAULT ARRAY[]::"PreTradeMoodTag"[];
