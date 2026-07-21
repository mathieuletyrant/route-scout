import { Controller, Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';

@Controller('invoices')
export class BillingInvoicesApiController {
  @Get(':id')
  @ApiOperation({ operationId: 'getInvoice' })
  getInvoice(id: string) {
    return this.billing.publicInvoice(id);
  }
}
