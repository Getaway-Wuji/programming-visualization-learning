#include <stdio.h>
int main(void) {
    int x = -7;
    printf("%d\n", x); x = x / 0;
    printf("%d\n", x);
    return 0;
}
