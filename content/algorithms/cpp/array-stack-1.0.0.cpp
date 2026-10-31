#include <iostream>
// @phase setup
int main() {
    int encodedLength = {{n}};
    int data[5];
    int top = 0;
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
            if (top == 5) {
                outcome = 3;
                std::cout << "FULL " << value << "\n";
            } else {
                // @phase store
                data[top] = value;
                top = top + 1;
                outcome = 1;
                std::cout << "IN " << value << "\n";
            }
        }
        // @phase remove
        else if (command == 2) {
            if (top == 0) {
                outcome = 4;
                std::cout << "EMPTY\n";
            } else {
                // @phase take
                int value = data[top - 1];
                top = top - 1;
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
