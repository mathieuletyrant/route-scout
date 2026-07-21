import { Controller, Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';

@Controller('invoices')
export class OrdersInvoicesInternalController {
  @Get(':id')
  @ApiOperation({ operationId: 'getInvoice' })
  getInvoice(id: string) {
    return this.orders.internalInvoice(id);
  }
}
