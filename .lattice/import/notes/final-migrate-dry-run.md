## 実装結果

`migrate --dry-run --json`は最大64件の独立違反を集約し、成功時は予定plan、dispatch shape、実write commandを返す。storeとdashboard registryを変更しないことをnegative／positive fixtureで確認した。
