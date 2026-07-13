import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PrintRepStockRequestButton } from "@/components/reps/PrintRepStockRequestButton";
import { RepStockRequestPrintView } from "@/components/reps/RepStockRequestPrintView";

interface AdminRepRequestPrintPageProps {
  params: Promise<{ requestId: string }>;
}

export default async function AdminRepRequestPrintPage({ params }: AdminRepRequestPrintPageProps) {
  const { requestId } = await params;

  const request = await prisma.stockRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      requestNumber: true,
      status: true,
      createdAt: true,
      repNote: true,
      adminNote: true,
      salesRep: {
        select: {
          user: { select: { name: true } },
          carStockLocation: { select: { name: true } },
        },
      },
      items: {
        select: {
          id: true,
          requestedQuantity: true,
          approvedQuantity: true,
          product: { select: { sku: true, name: true, nameAr: true } },
        },
      },
    },
  });

  if (!request) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/admin/rep-requests/${request.id}`} className="text-sm text-gold-champagne hover:underline">
          العودة إلى تفاصيل الطلب
        </Link>
        <PrintRepStockRequestButton />
      </div>

      <RepStockRequestPrintView
        request={{
          id: request.id,
          requestNumber: request.requestNumber,
          status: request.status,
          createdAt: request.createdAt,
          repName: request.salesRep.user.name,
          destinationLocationName: request.salesRep.carStockLocation?.name ?? "مخزون المندوب",
          repNote: request.repNote,
          adminNote: request.adminNote,
          items: request.items.map((item) => ({
            id: item.id,
            productLabel: item.product.nameAr ?? item.product.name,
            sku: item.product.sku,
            requestedQuantity: item.requestedQuantity,
            approvedQuantity: item.approvedQuantity,
          })),
        }}
      />
    </div>
  );
}
