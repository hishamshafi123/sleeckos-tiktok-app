import { prisma } from "../src/lib/db";

async function main() {
  const templates = await prisma.trackLyricalTemplate.findMany({
    orderBy: { createdAt: "desc" },
  });

  console.log("=== TRACK LYRICAL TEMPLATES ===");
  for (const t of templates) {
    console.log(`ID: ${t.id}`);
    console.log(`Name: ${t.templateName}`);
    console.log(`Font: ${t.fontFamily} (${t.fontSize}px)`);
    console.log(`Active Color: ${t.activeColor}`);
    console.log(`Text Color: ${t.textColor}`);
    console.log(`Bg Color: ${t.bgColor}`);
    console.log(`Stroke: ${t.strokeWidth}px (${t.strokeColor})`);
    console.log(`Overlay URL: ${t.overlayVideoUrl}`);
    console.log(`Preview URL: ${t.previewImageUrl}`);
    console.log(`-----------------------------------`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
