import { InstrumentIdType } from '../../src/generated/instruments.js';
import { CandleInterval } from '../../src/generated/marketdata.js';
import { OperationState } from '../../src/generated/operations.js';
import { OrderDirection, OrderExecutionReportStatus, OrderType } from '../../src/generated/orders.js';
import { Backtest, Helpers } from '../../src/index.js';

describe('backtest', () => {

  const figi = 'BBG004730N88';

  function createBacktest() {
    return new Backtest({
      candles: 'test/data/candles.json',
      instruments: { shares: 'test/data/shares.json' }
    });
  }

  async function getOrdersCount(backtest: Backtest) {
    const { orders } = await backtest.api.orders.getOrders({ accountId: '' });
    return orders.length;
  }

  async function getOperations(backtest: Backtest) {
    const { operations } = await backtest.api.operations.getOperations({
      figi,
      state: OperationState.OPERATION_STATE_EXECUTED,
      accountId: '',
    });
    return operations;
  }

  it('getAccounts', async () => {
    const backtest = createBacktest();
    const res = await backtest.api.users.getAccounts({});
    assert.equal(res.accounts[ 0 ].id, '0000000000');
  });

  it('getPortfolio', async () => {
    const backtest = createBacktest();
    const res = await backtest.api.operations.getPortfolio({ accountId: 'x' });
    assert.deepEqual(res.positions, []);
    assert.deepEqual(res.totalAmountCurrencies, {
      units: 100_000,
      nano: 0,
      currency: 'rub',
    });
  });

  it('getInstrumentBy', async () => {
    const backtest = createBacktest();
    const { instrument } = await backtest.api.instruments.getInstrumentBy({
      idType: InstrumentIdType.INSTRUMENT_ID_TYPE_FIGI,
      classCode: '',
      id: 'BBG004730N88'
    });
    assert.equal(instrument?.ticker, 'SBER');
    assert.equal(instrument?.tradingStatus, 5);
  });

  it('getCapital', async () => {
    const backtest = createBacktest();
    const capital = await backtest.getCapital();
    assert.equal(capital, 100_000);
  });

  it('итерация по свечам', async () => {
    const backtest = createBacktest();
    const interval = CandleInterval.CANDLE_INTERVAL_1_MIN;

    await backtest.tick();
    const res = await backtest.api.marketdata.getCandles({ figi, interval });
    assert.equal(res.candles.length, 1);
    assert.deepEqual(res.candles[ 0 ].close, { units: 122, nano: 860000000 });

    await backtest.tick();
    const res1 = await backtest.api.marketdata.getCandles({ figi, interval });
    assert.equal(res1.candles.length, 2);
    assert.deepEqual(res1.candles[ 0 ].close, { units: 122, nano: 860000000 });
    assert.deepEqual(res1.candles[ 1 ].close, { units: 123, nano: 650000000 });

    while (await backtest.tick()) {
      // noop
    }
    const res2 = await backtest.api.marketdata.getCandles({ figi, interval });
    assert.equal(res2.candles.length, 525);
  });

  it('покупка по рыночной цене', async () => {
    const backtest = createBacktest();

    await backtest.tick();
    assert.equal(await getOrdersCount(backtest), 0);

    // создать заявку
    const res = await backtest.api.orders.postOrder({
      accountId: '',
      figi,
      quantity: 1,
      direction: OrderDirection.ORDER_DIRECTION_BUY,
      orderType: OrderType.ORDER_TYPE_MARKET,
      orderId: '1',
    });
    assert.equal(res.figi, figi);
    assert.equal(res.executionReportStatus, OrderExecutionReportStatus.EXECUTION_REPORT_STATUS_NEW);
    assert.equal(Helpers.toNumber(res.initialOrderPrice), 1228.6);
    assert.equal(await getOrdersCount(backtest), 1);

    await backtest.tick();
    assert.equal(await getOrdersCount(backtest), 0);

    // check operations
    const operations = await getOperations(backtest);
    assert.equal(operations.length, 2);
    assert.deepEqual(operations[ 0 ].payment, { units: -1228, nano: -600000000, currency: 'rub' });
    // 1228.6 * 0.003 = 3.6858
    assert.deepEqual(operations[ 1 ].payment, { units: -3, nano: -685800000, currency: 'rub' });

    // check balance and capital: 100_000 - (1228.6 + 3.6858) = 98767.7142
    const portfolio = await backtest.api.operations.getPortfolio({ accountId: '' });
    assert.deepEqual(portfolio.totalAmountCurrencies, { units: 98767, nano: 714200000, currency: 'rub' });
    assert.deepEqual(portfolio.totalAmountShares, { units: 1228, nano: 600000000, currency: 'rub' });
    assert.equal((await backtest.getCapital()).toFixed(4), '99996.3142'); // 100_000 - 3.6858 = 99996.3142

    // check positions
    assert.equal(portfolio.positions.length, 1);
    assert.deepEqual(portfolio.positions[0].averagePositionPrice, { units: 1228, nano: 600000000, currency: 'rub' });
    assert.deepEqual(portfolio.positions[0].quantityLots, { units: 1, nano: 0 });
    assert.deepEqual(portfolio.positions[0].quantity, { units: 1, nano: 0 });
    assert.equal(portfolio.positions[0].instrumentType, 'share');
  });

  it('продажа по рыночной цене', async () => {
    const backtest = createBacktest();
    await backtest.tick();
    assert.equal(await getOrdersCount(backtest), 0);

    // сначала покупаем 1 лот: цена 122.86 (+комиссия)
    await backtest.api.orders.postOrder({
      accountId: '',
      figi,
      quantity: 1,
      direction: OrderDirection.ORDER_DIRECTION_BUY,
      orderType: OrderType.ORDER_TYPE_MARKET,
      orderId: '1',
    });
    await backtest.tick();

    // теперь продаем этот 1 лот: цена 123.65 (-комиссия)
    await backtest.api.orders.postOrder({
      accountId: '',
      figi,
      quantity: 1,
      direction: OrderDirection.ORDER_DIRECTION_SELL,
      orderType: OrderType.ORDER_TYPE_MARKET,
      orderId: '2',
    });
    await backtest.tick();

    // check operations
    const operations = await getOperations(backtest);
    assert.equal(operations.length, 4);
    assert.deepEqual(operations[ 2 ].payment, { units: 1236, nano: 500000000, currency: 'rub' });
    // 1236.5 * 0.003 = 3.7095
    assert.deepEqual(operations[ 3 ].payment, { units: -3, nano: -709500000, currency: 'rub' });

    // check balance: 100_000 - (1228.6 + 3.6858) + (1236.5 - 3.7095) = 100000.5047
    const portfolio = await backtest.api.operations.getPortfolio({ accountId: '' });
    assert.deepEqual(portfolio.totalAmountCurrencies, { units: 100000, nano: 504700000, currency: 'rub' });

    // check positions
    assert.equal(portfolio.positions.length, 1);
    assert.deepEqual(portfolio.positions[0].quantityLots, { units: 0, nano: 0 });
    assert.deepEqual(portfolio.positions[0].quantity, { units: 0, nano: 0 });
    assert.deepEqual(portfolio.positions[0].averagePositionPrice, { units: 0, nano: 0, currency: 'rub' });
  });

  it('покупка по лимит-цене', async () => {
    const backtest = createBacktest();
    await backtest.tick();
    const res = await backtest.api.orders.postOrder({
      accountId: '',
      figi,
      quantity: 10,
      price: Helpers.toQuotation(123), // предыдущая свеча: l=122.8, h=123.87, заявка должна исполниться
      direction: OrderDirection.ORDER_DIRECTION_BUY,
      orderType: OrderType.ORDER_TYPE_LIMIT,
      orderId: '1',
    });
    assert.deepEqual(res.initialOrderPrice, { units: 12300, nano: 0, currency: 'rub' });

    await backtest.tick();
    assert.equal(await getOrdersCount(backtest), 0);

    // check operations
    const { operations } = await backtest.api.operations.getOperations({
      figi,
      state: OperationState.OPERATION_STATE_EXECUTED,
      accountId: '',
    });
    assert.equal(operations.length, 2);
    assert.deepEqual(operations[ 0 ].payment, { units: -12300, nano: -0, currency: 'rub' });
    // 12300 * 0.003 = 36.9
    assert.deepEqual(operations[ 1 ].payment, { units: -36, nano: -900000000, currency: 'rub' });
  });

  it('недостаточно лотов для продажи', async () => {
    const backtest = createBacktest();
    await backtest.tick();
    const promise = backtest.api.orders.postOrder({
      accountId: '',
      figi,
      quantity: 5,
      direction: OrderDirection.ORDER_DIRECTION_SELL,
      orderType: OrderType.ORDER_TYPE_MARKET,
      orderId: '1',
    });
    await assert.rejects(promise, /Недостаточно лотов для заявки: 5 > 0/);
  });

});
