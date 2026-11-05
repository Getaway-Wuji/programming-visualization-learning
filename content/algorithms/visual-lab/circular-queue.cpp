#include <iostream>

int main() {
    int count; std::cin >> count;
    int a[8] = {}; int size = 0; int front = 0; int rear = 0;
    // 开始观察算法
    for (int step = 0; step < count; step = step + 1) {
        int command; int value; std::cin >> command >> value;
        if (command == 1) {
            if (size == 8) { std::cout << "full "; }
            else { a[rear] = value; rear = (rear + 1) % 8; size = size + 1; }
        } else {
            if (size == 0) { std::cout << "empty "; }
            else { std::cout << a[front] << " "; front = (front + 1) % 8; size = size - 1; }
        }
    }
    std::cout << "\n";
    return 0;
}
