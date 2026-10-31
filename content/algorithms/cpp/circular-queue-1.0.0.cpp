#include <iostream>
// @phase setup
int main() {
    int encodedLength = {{n}};
    int data[5];
    int head = 0;
    int tail = 0;
    int consumed = 0;
    int processed = 0;
    int outcome = 0;
    // @phase read
    while (consumed < encodedLength) {
        outcome = 0;
        int command;
        std::cin >> command;
        consumed = consumed + 1;
        // @phase dispatch
        if (command == 1) {
            // @phase insert
            int value;
            std::cin >> value;
            consumed = consumed + 1;
            if (tail - head == 5) {
                outcome = 3;
                std::cout << "FULL " << value << "\n";
            } else {
                // @phase store
                int slot = tail % 5;
                data[slot] = value;
                tail = tail + 1;
                outcome = 1;
                std::cout << "IN " << value << "\n";
            }
        }
        // @phase remove
        else if (command == 2) {
            if (head == tail) {
                outcome = 4;
                std::cout << "EMPTY\n";
            } else {
                // @phase take
                int slot = head % 5;
                int value = data[slot];
                head = head + 1;
                outcome = 2;
                std::cout << "OUT " << value << "\n";
            }
        }
        // @phase invalid
        else {
            outcome = 5;
            std::cout << "INVALID " << command << "\n";
            return 1;
        }
        // @phase advance
        processed = processed + 1;
    }
    // @phase finish
    std::cout << "END\n";
    return 0;
}
