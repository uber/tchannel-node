.PHONY: test_server

TEST_HOST=127.0.0.1
TEST_PORT=0
TEST_LOG_FILE=test-server.log

test_server:
	node test/lib/run_server.js --logFile ${TEST_LOG_FILE} --host ${TEST_HOST} --port ${TEST_PORT}

