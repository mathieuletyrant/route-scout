import { Controller, Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';

@Controller('invoices')
export class BillingInvoicesInternalController {
  @Get(':id')
  @ApiOperation({ operationId: 'getInvoice' })
  getInvoice(id: string) {
    return this.billing.internalInvoice(id);
  }
}
