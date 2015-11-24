struct GetResult {
    1: required string value
}

service KeyValue {
    GetResult get_v1(
        1: required string key
    )
    void put_v1(
        1: required string key,
        2: required string value
    )
}
