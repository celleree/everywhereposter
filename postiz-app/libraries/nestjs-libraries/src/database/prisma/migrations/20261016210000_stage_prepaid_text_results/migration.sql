CREATE TABLE "AiTextResult" (
  "reservationId" TEXT PRIMARY KEY REFERENCES "AiWalletReservation"("id"),
  "output" JSONB NOT NULL
);
